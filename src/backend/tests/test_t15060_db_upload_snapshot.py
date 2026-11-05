"""T15060: a per-user DB is uploaded from a private snapshot, never the live file.

Prod 2026-11-04: `client.upload_file` on user.sqlite failed with BadDigest. botocore
hashes the file for Content-MD5, then reads it again for the body. `get_upload_lock`
serialises uploaders only, so an ordinary connection closing as the last one
checkpoints its WAL frames into the main file between those two reads. At 8 MiB and
up each part has its own MD5, so the same change between parts is not rejected: R2
keeps a torn object and the sync reports success.

`_TwoPassR2` models that read pattern against the path the primitive hands it, and
fires a real commit-and-close in the gap.
"""

import hashlib
import logging
import os
import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest
from boto3.exceptions import S3UploadFailedError
from botocore.exceptions import ClientError

from app import storage
from app.storage import sync_database_to_r2_with_version, sync_user_db_to_r2_with_version
from app.utils.retry import is_transient_error
from tests.test_t4050_durable_sync import FakeR2, _r2_patched
from tests.test_t5920_checkpoint_before_upload import (
    PROFILE,
    USER,
    _make_wal_profile_db,
    _make_wal_user_db,
    _markers_in_r2_object,
)

USER_KEY = storage._user_db_r2_key(USER)
BAD_DIGEST_TEXT = (
    "An error occurred (BadDigest) when calling the PutObject operation (reached max "
    "retries: 0): The MD5 checksum you specified did not match what we received."
)


def _bad_digest_client_error():
    return ClientError(
        {"Error": {"Code": "BadDigest", "Message": "The MD5 checksum you specified did not match"}},
        "PutObject",
    )


def _bad_digest_upload_failed():
    return S3UploadFailedError(f"Failed to upload a to b: {BAD_DIGEST_TEXT}")


def _commit_and_close(db_path, who):
    """A real writer: commit, then close as the last connection, which is what
    checkpoints the WAL frames into the main file in place."""
    conn = sqlite3.connect(str(db_path))
    conn.execute("INSERT INTO marker (who) VALUES (?)", (who,))
    conn.commit()
    conn.close()


class _TwoPassR2(FakeR2):
    """Content-MD5 pass, then `between()`, then the body read. Like R2, refuses a
    body that does not match the digest."""

    def __init__(self, between):
        super().__init__()
        self.between = between
        self.filenames = []

    def upload_file(self, Filename, Bucket, Key, ExtraArgs=None, Callback=None, Config=None):
        self.filenames.append(Filename)
        digest = hashlib.md5(Path(Filename).read_bytes()).hexdigest()
        self.between()
        body = Path(Filename).read_bytes()
        if hashlib.md5(body).hexdigest() != digest:
            raise _bad_digest_client_error()
        self._store(Key, body, ExtraArgs)
        self.upload_calls.append(("upload_file", Key, ExtraArgs["Metadata"]["db-version"]))


class _SplitReadR2(FakeR2):
    """Multipart shape: each half is read once, with `between()` after the first.
    Per-part digests pass, so nothing rejects a file that changed between parts."""

    def __init__(self, between):
        super().__init__()
        self.between = between

    def upload_file(self, Filename, Bucket, Key, ExtraArgs=None, Callback=None, Config=None):
        with open(Filename, "rb") as f:
            size = os.fstat(f.fileno()).st_size
            first = f.read(size // 2)
            self.between()
            rest = f.read()
        self._store(Key, first + rest, ExtraArgs)
        self.upload_calls.append(("upload_file", Key, ExtraArgs["Metadata"]["db-version"]))


class _ScriptedFailR2(FakeR2):
    """Raises the scripted exceptions on successive uploads, then behaves. Calls
    `on_fail` after each raise."""

    def __init__(self, failures, on_fail=lambda: None):
        super().__init__()
        self.failures = list(failures)
        self.on_fail = on_fail
        self.attempts = 0

    def upload_file(self, Filename, Bucket, Key, ExtraArgs=None, Callback=None, Config=None):
        self.attempts += 1
        if self.failures:
            exc = self.failures.pop(0)
            self.on_fail()
            raise exc
        super().upload_file(Filename, Bucket, Key, ExtraArgs, Callback, Config)


def _sync_user(path):
    return sync_user_db_to_r2_with_version(USER, path, 0)


def _sync_profile(path):
    return sync_database_to_r2_with_version(USER, path, 0, profile_id=PROFILE)


@pytest.fixture(params=["user", "profile"])
def db(request, tmp_path):
    """The primitive under test with its DB; both twins share the exposure."""
    if request.param == "user":
        return _make_wal_user_db(tmp_path), _sync_user
    return _make_wal_profile_db(tmp_path), _sync_profile


def _only_key(fake):
    (key,) = fake._objects
    return key


class TestConcurrentWriteDuringUpload:

    def test_last_close_between_digest_and_body_does_not_fail_the_upload(self, db):
        """The incident. The commit lands after the digest pass and is not refused."""
        path, sync = db
        fake = _TwoPassR2(lambda: _commit_and_close(path, "mid-upload"))
        with _r2_patched(fake):
            ok, version = sync(path)
        assert (ok, version) == (True, 1)
        assert _markers_in_r2_object(fake, _only_key(fake)) == ["v0"]

    def test_commit_during_upload_stays_dirty_so_it_syncs_later(self, db):
        """The object lacks the late commit, so the clean mark must not claim it."""
        path, sync = db
        fake = _TwoPassR2(lambda: _commit_and_close(path, "mid-upload"))
        with _r2_patched(fake):
            assert sync(path)[0] is True
        key = storage._db_key(path)
        assert storage._DB_CLEAN_MARKS[key][0] != storage._db_fingerprint(path)

    def test_commit_between_mark_and_snapshot_is_uploaded_and_reads_dirty(self, db):
        """The mark may under-claim (one extra upload) but never over-claim."""
        path, sync = db
        real_snapshot = storage._snapshot_db_or_refuse

        def commit_then_snapshot(*args):
            _commit_and_close(path, "late")
            return real_snapshot(*args)

        fake = FakeR2()
        with _r2_patched(fake), patch.object(storage, "_snapshot_db_or_refuse", commit_then_snapshot):
            assert sync(path)[0] is True
        assert _markers_in_r2_object(fake, _only_key(fake)) == ["late", "v0"]
        assert storage._DB_CLEAN_MARKS[storage._db_key(path)][0] != storage._db_fingerprint(path)

    def test_change_between_parts_cannot_tear_the_object(self, tmp_path):
        """One transaction updates both ends of a multi-page DB between the two part
        reads. The object must show the transaction entirely or not at all."""
        path = _make_wal_user_db(tmp_path)
        conn = sqlite3.connect(str(path))
        conn.execute("CREATE TABLE head (v TEXT)")
        conn.execute("INSERT INTO head VALUES ('old')")
        conn.execute("CREATE TABLE filler (b BLOB)")
        conn.executemany("INSERT INTO filler VALUES (?)", [(b"x" * 4000,)] * 400)
        conn.execute("CREATE TABLE tail (v TEXT)")
        conn.execute("INSERT INTO tail VALUES ('old')")
        conn.commit()
        conn.close()

        def update_both_ends():
            c = sqlite3.connect(str(path))
            c.execute("UPDATE head SET v='new'")
            c.execute("UPDATE tail SET v='new'")
            c.commit()
            c.close()

        fake = _SplitReadR2(update_both_ends)
        with _r2_patched(fake):
            assert _sync_user(path)[0] is True

        restored = tmp_path / "restored.sqlite"
        restored.write_bytes(fake._objects[USER_KEY]["data"])
        conn = sqlite3.connect(str(restored))
        head = conn.execute("SELECT v FROM head").fetchone()[0]
        tail = conn.execute("SELECT v FROM tail").fetchone()[0]
        conn.close()
        assert head == tail, "torn object: one transaction is half present in R2"


class TestSnapshotFile:

    def test_upload_reads_a_private_copy_that_is_removed_afterwards(self, db):
        path, sync = db
        fake = _TwoPassR2(lambda: None)
        with _r2_patched(fake):
            assert sync(path)[0] is True
        (uploaded,) = fake.filenames
        assert Path(uploaded) != path
        assert not Path(uploaded).parent.exists()

    def test_snapshot_restores_as_the_same_wal_db(self, tmp_path):
        """Header stays WAL and user_version survives, which VACUUM INTO would not
        give: a restored file must not need a first-open WAL conversion."""
        path = _make_wal_user_db(tmp_path)
        conn = sqlite3.connect(str(path))
        conn.execute("PRAGMA user_version=37")
        conn.commit()
        conn.close()
        fake = FakeR2()
        with _r2_patched(fake):
            assert _sync_user(path)[0] is True
        data = fake._objects[USER_KEY]["data"]
        assert (data[18], data[19]) == (2, 2)
        restored = tmp_path / "restored.sqlite"
        restored.write_bytes(data)
        conn = sqlite3.connect(str(restored))
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 37
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        conn.close()

    def test_snapshot_gives_up_on_a_locked_db_instead_of_hanging(self, tmp_path):
        """backup() retries BUSY forever and connection timeouts do not bound it. The
        upload lock is held here, so an exclusive holder (the T5086 WAL probe) must
        cost a bounded wait and a loud refusal."""
        path = _make_wal_user_db(tmp_path)
        holder = sqlite3.connect(str(path))
        holder.execute("PRAGMA locking_mode=EXCLUSIVE")
        holder.execute("BEGIN IMMEDIATE")
        holder.execute("COMMIT")
        try:
            with patch.object(storage, "SNAPSHOT_TIMEOUT_S", 0.2):
                ok = storage._snapshot_db_or_refuse(path, USER, tmp_path / "snapshot.sqlite")
        finally:
            holder.close()
        assert ok is False

    def test_snapshot_failure_refuses_the_upload(self, db):
        path, sync = db
        fake = FakeR2()
        with _r2_patched(fake), patch.object(storage, "_snapshot_db_or_refuse", lambda *a: False):
            assert sync(path) == (False, None)
        assert fake.upload_calls == []


class TestBadDigestRetry:

    @pytest.mark.parametrize("make_error", [_bad_digest_client_error, _bad_digest_upload_failed])
    def test_retries_once_from_a_fresh_snapshot(self, db, make_error):
        """The commit between attempts is in the object, so the retry re-snapshotted
        rather than resending the same bytes."""
        path, sync = db
        fake = _ScriptedFailR2([make_error()], lambda: _commit_and_close(path, "between"))
        with _r2_patched(fake):
            assert sync(path) == (True, 1)
        assert fake.attempts == 2
        assert _markers_in_r2_object(fake, _only_key(fake)) == ["between", "v0"]

    def test_repeat_is_critical_and_fails_without_advancing_anything(self, db, caplog):
        path, sync = db
        fake = _ScriptedFailR2([_bad_digest_client_error(), _bad_digest_client_error()])
        with _r2_patched(fake), caplog.at_level(logging.WARNING, logger="app.storage"):
            assert sync(path) == (False, None)
        assert fake.attempts == 2
        assert fake._objects == {}
        assert storage._db_key(path) not in storage._DB_CLEAN_MARKS
        critical = [r for r in caplog.records if r.levelno == logging.CRITICAL]
        assert len(critical) == 1 and "[SYNC_BAD_DIGEST]" in critical[0].getMessage()

    def test_other_upload_failures_do_not_resnapshot(self, db):
        path, sync = db
        denied = ClientError({"Error": {"Code": "403", "Message": "denied"}}, "PutObject")
        fake = _ScriptedFailR2([denied])
        with _r2_patched(fake):
            assert sync(path) == (False, None)
        assert fake.attempts == 1

    def test_classifier_stays_out_of_the_generic_retry_path(self):
        """retry_r2_call resends the same arguments, so BadDigest must stay
        non-transient there; only the snapshot loop may retry it."""
        from app.utils.retry import is_bad_digest

        for exc in (_bad_digest_client_error(), _bad_digest_upload_failed()):
            assert is_bad_digest(exc) is True
            assert is_transient_error(exc) is False
        assert is_bad_digest(ClientError({"Error": {"Code": "403", "Message": "x"}}, "PutObject")) is False
