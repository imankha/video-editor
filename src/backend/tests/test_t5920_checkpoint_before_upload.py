"""T5920 — WAL checkpoint before R2 upload (systemic under-checkpoint hazard).

Every per-user SQLite DB is replicated to R2 by uploading the MAIN FILE ONLY. In
WAL mode, committed-but-uncheckpointed transactions live in the `-wal` sidecar and
are flushed to the main file only on last-connection-close. If ANY other connection
holds the DB open when a sync runs, the upload ships pre-commit bytes stamped at a
BUMPED version -- worse than not syncing at all, because every downstream guard
(T4315 restore-if-newer, T4310 CAS, Postgres "materialized" marks) then trusts that
stale-content-newer-version copy and the write is silently, permanently lost.

The landmine that makes the naive fix useless: `PRAGMA wal_checkpoint(TRUNCATE)`
does NOT raise on contention -- it returns `(busy, log, checkpointed)` with busy=1
and leaves the frames in the WAL. An unchecked checkpoint is a silent no-op. So the
fix is a checkpoint-or-REFUSE guard inside the upload primitive (storage.py's
`sync_*_to_r2_with_version`), covering every caller: read the busy flag, and on
busy fail the sync LOUDLY (no upload, no version bump, stays retryable) rather than
shipping stale bytes.

Covers the acceptance criteria:
- No R2 upload can ship an under-checkpointed file (enforced in the primitive).
- A busy checkpoint fails the sync loudly (no upload, no version bump) and stays
  retryable (SyncResult.FAILED + .sync_pending stays).
- No 30s-per-attempt stall -- the checkpoint uses its own 2000ms busy_timeout.
- The highest-traffic path (db_sync.py `_background_sync`) is covered.
- Regression: hold an open connection, commit a change, run the sync -> EITHER the
  uploaded object contains the change OR the sync refused; NEVER stale-bytes-at-a-
  bumped-version. Goes RED if the guard is removed (the refusal asserts uploads=0
  and version-unchanged; without the guard the stale main file uploads at v1).
"""

import asyncio
import os
import sqlite3
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from app.database import SyncResult
from tests.test_t4050_durable_sync import FakeR2, _r2_patched

USER = "u_t5920"
PROFILE = "5920abcd"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _make_wal_profile_db(base, user_id=USER, profile_id=PROFILE, marker="v0"):
    """Create a WAL-mode profile.sqlite with one marker row, checkpointed so the
    MAIN file is self-contained (clean sidecar)."""
    d = base / user_id / "profiles" / profile_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / "profile.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE marker (who TEXT)")
    conn.execute("INSERT INTO marker (who) VALUES (?)", (marker,))
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    return p


def _make_wal_user_db(base, user_id=USER, marker="v0"):
    d = base / user_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / "user.sqlite"
    conn = sqlite3.connect(str(p))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE marker (who TEXT)")
    conn.execute("INSERT INTO marker (who) VALUES (?)", (marker,))
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    return p


def _seed_r2_from_file(fake, key, db_path, version=0):
    """Seed the fake R2 object with the current main-file bytes at `version`."""
    with open(db_path, "rb") as f:
        fake._objects[key] = {"data": f.read(), "metadata": {"db-version": str(version)}}


def _markers_in_r2_object(fake, key):
    """Read the uploaded R2 bytes back as a SQLite DB and return the marker rows.
    The uploaded object is the main file only, so it MUST be self-contained
    (checkpointed) for the shared game/clip data to be present."""
    data = fake._objects[key]["data"]
    fd, tmp = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    try:
        with open(tmp, "wb") as f:
            f.write(data)
        c = sqlite3.connect(tmp)
        try:
            return [r[0] for r in c.execute("SELECT who FROM marker ORDER BY who").fetchall()]
        finally:
            c.close()
    finally:
        os.unlink(tmp)


class _OpenSnapshot:
    """Hold a genuine open read snapshot on a WAL DB across a block, pinning the
    WAL so a concurrent `wal_checkpoint(TRUNCATE)` reports busy=1 -- the exact
    contention the reproduction in the task used ('one extra connection holding
    an open read snapshot')."""

    def __init__(self, db_path):
        self.db_path = str(db_path)
        self.conn = None

    def __enter__(self):
        self.conn = sqlite3.connect(self.db_path)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("BEGIN")
        self.conn.execute("SELECT * FROM marker").fetchall()  # opens the read txn
        return self

    def __exit__(self, *exc):
        try:
            self.conn.rollback()
        finally:
            self.conn.close()


# ---------------------------------------------------------------------------
# 1. Primitive guard: a busy checkpoint refuses loudly (profile.sqlite)
# ---------------------------------------------------------------------------

class TestCheckpointGuardProfile:

    def test_busy_checkpoint_refuses_loudly(self, tmp_path):
        """The core regression. A committed change sits in the WAL (main file
        stale) while a concurrent open snapshot forces the checkpoint busy. The
        sync MUST refuse: no upload, no version bump, stays retryable.

        Goes RED without the guard -- the stale main file would upload at v1, so
        `upload_calls` would be non-empty and R2's db-version would advance."""
        from app.database import (
            get_local_db_version,
            has_sync_pending,
            mark_sync_pending,
            set_local_db_version,
            sync_db_to_r2_explicit,
        )
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            db_path = _make_wal_profile_db(tmp_path)
            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            _seed_r2_from_file(fake, key, db_path, version=0)
            set_local_db_version(USER, PROFILE, 0)
            mark_sync_pending(USER, scope=PROFILE)  # a write is outstanding

            # Writer commits a change INTO the WAL; kept open so the main file is
            # never auto-checkpointed. Reader holds an open snapshot -> busy.
            writer = sqlite3.connect(str(db_path))
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("INSERT INTO marker (who) VALUES ('contended_change')")
            writer.commit()
            try:
                with _OpenSnapshot(db_path):
                    result = sync_db_to_r2_explicit(USER, PROFILE)

                assert result is SyncResult.FAILED, (
                    "a busy checkpoint must fail the sync (retryable), not upload stale bytes"
                )
                # No upload landed at all.
                assert not any(c[1] == key for c in fake.upload_calls), (
                    "REGRESSION: an under-checkpointed main file was uploaded"
                )
                # No version bump: R2 metadata and the local baseline both untouched.
                assert fake._objects[key]["metadata"]["db-version"] == "0"
                assert get_local_db_version(USER, PROFILE) == 0
                # Retryable: the pending marker survives (existing Retry UX).
                assert has_sync_pending(USER)
            finally:
                writer.close()

    def test_retry_after_contention_clears_uploads_the_change(self, tmp_path):
        """Once the contending connection is gone, the retry succeeds and the
        uploaded object CONTAINS the change (proves the guard flushes the WAL and
        the loss is only deferred, never permanent)."""
        from app.database import (
            get_local_db_version,
            set_local_db_version,
            sync_db_to_r2_explicit,
        )
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            db_path = _make_wal_profile_db(tmp_path)
            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            _seed_r2_from_file(fake, key, db_path, version=0)
            set_local_db_version(USER, PROFILE, 0)

            writer = sqlite3.connect(str(db_path))
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("INSERT INTO marker (who) VALUES ('contended_change')")
            writer.commit()

            with _OpenSnapshot(db_path):
                assert sync_db_to_r2_explicit(USER, PROFILE) is SyncResult.FAILED
            writer.close()  # contention cleared

            result = sync_db_to_r2_explicit(USER, PROFILE)

            assert result is SyncResult.OK
            assert get_local_db_version(USER, PROFILE) == 1
            assert fake._objects[key]["metadata"]["db-version"] == "1"
            assert _markers_in_r2_object(fake, key) == ["contended_change", "v0"], (
                "the uploaded object must contain the committed change (WAL flushed)"
            )

    def test_uncontended_sync_uploads_current_bytes(self, tmp_path):
        """No contention: writer commits then CLOSES. The guard's checkpoint is a
        no-op flush and the upload is current -- the normal path is unbroken."""
        from app.database import set_local_db_version, sync_db_to_r2_explicit
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            db_path = _make_wal_profile_db(tmp_path)
            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            _seed_r2_from_file(fake, key, db_path, version=0)
            set_local_db_version(USER, PROFILE, 0)

            w = sqlite3.connect(str(db_path))
            w.execute("PRAGMA journal_mode=WAL")
            w.execute("INSERT INTO marker (who) VALUES ('clean_change')")
            w.commit()
            w.close()

            assert sync_db_to_r2_explicit(USER, PROFILE) is SyncResult.OK
            assert _markers_in_r2_object(fake, key) == ["clean_change", "v0"]

    def test_refusal_is_fast_no_30s_stall(self, tmp_path):
        """The checkpoint must use its own short (2000ms) busy_timeout, NOT the
        connection's inherited 30000ms. A refused sync returns in a couple of
        seconds, nowhere near 30s."""
        from app.database import set_local_db_version, sync_db_to_r2_explicit
        from app.storage import profile_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            db_path = _make_wal_profile_db(tmp_path)
            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            _seed_r2_from_file(fake, key, db_path, version=0)
            set_local_db_version(USER, PROFILE, 0)

            writer = sqlite3.connect(str(db_path))
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("INSERT INTO marker (who) VALUES ('contended')")
            writer.commit()
            try:
                with _OpenSnapshot(db_path):
                    t0 = time.perf_counter()
                    result = sync_db_to_r2_explicit(USER, PROFILE)
                    elapsed = time.perf_counter() - t0

                assert result is SyncResult.FAILED
                assert elapsed < 10.0, (
                    f"refused sync took {elapsed:.1f}s -- checkpoint inherited the 30s "
                    f"busy_timeout instead of using its own 2000ms"
                )
            finally:
                writer.close()


# ---------------------------------------------------------------------------
# 2. Primitive guard: user.sqlite variant
# ---------------------------------------------------------------------------

class TestCheckpointGuardUserDb:

    def test_busy_checkpoint_refuses_loudly(self, tmp_path):
        from app.database import (
            get_local_user_db_version,
            set_local_user_db_version,
            sync_user_db_to_r2_explicit,
        )
        from app.storage import _user_db_r2_key

        fake = FakeR2()
        with patch("app.database.USER_DATA_BASE", tmp_path), _r2_patched(fake):
            db_path = _make_wal_user_db(tmp_path)
            key = _user_db_r2_key(USER)
            _seed_r2_from_file(fake, key, db_path, version=0)
            set_local_user_db_version(USER, 0)

            writer = sqlite3.connect(str(db_path))
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("INSERT INTO marker (who) VALUES ('contended_change')")
            writer.commit()
            try:
                with _OpenSnapshot(db_path):
                    result = sync_user_db_to_r2_explicit(USER)

                assert result is SyncResult.FAILED
                assert not any(c[1] == key for c in fake.upload_calls)
                assert fake._objects[key]["metadata"]["db-version"] == "0"
                assert get_local_user_db_version(USER) == 0
            finally:
                writer.close()


# ---------------------------------------------------------------------------
# 3. Highest-traffic path: db_sync.py _background_sync is covered
# ---------------------------------------------------------------------------

class TestBackgroundSyncCheckpointCoverage:

    @pytest.fixture(autouse=True)
    def isolate(self, tmp_path, monkeypatch):
        import app.database as db_module
        from app.middleware import db_sync as m
        monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
        monkeypatch.setattr(m, "_USER_WRITE_LOCKS", {})
        monkeypatch.setattr(m, "_SYNC_IN_PROGRESS", {})

    def test_background_sync_refuses_under_contention(self, tmp_path):
        """The end-of-request sync path (`_background_sync` -> sync_db_to_r2_explicit
        -> the primitive guard) must ALSO refuse an under-checkpointed upload and
        leave the retry marker set -- this is the highest-traffic sync path, not
        just teammate-share materialization."""
        from app.database import (
            get_local_db_version,
            has_sync_pending,
            mark_sync_pending,
            set_local_db_version,
        )
        from app.middleware.db_sync import RequestContextMiddleware, _begin_sync_attempt
        from app.storage import profile_r2_key

        fake = FakeR2()
        with _r2_patched(fake):
            db_path = _make_wal_profile_db(tmp_path)
            key = profile_r2_key(USER, PROFILE, "profile.sqlite")
            _seed_r2_from_file(fake, key, db_path, version=0)
            set_local_db_version(USER, PROFILE, 0)
            # T5081: retry_pending_sync (which the re-drain below calls) is now
            # gated on the SCOPED marker — mark the profile scope specifically so
            # the re-drain actually re-attempts it instead of vacuously no-op'ing.
            mark_sync_pending(USER, scope=PROFILE)
            _begin_sync_attempt(USER)

            writer = sqlite3.connect(str(db_path))
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("INSERT INTO marker (who) VALUES ('contended_change')")
            writer.commit()

            middleware = RequestContextMiddleware(app=None)

            async def runner():
                with _OpenSnapshot(db_path):
                    return await middleware._background_sync(
                        USER, PROFILE, "rid-5920", "POST", "/api/test",
                        had_writes=True, had_user_db_writes=False,
                        do_profile=False, force_profile=False,
                    )

            try:
                status = asyncio.run(runner())
            finally:
                writer.close()

            assert status != "ok", "background sync must not report success on a busy checkpoint"
            assert not any(c[1] == key for c in fake.upload_calls), (
                "REGRESSION: _background_sync uploaded an under-checkpointed main file"
            )
            assert fake._objects[key]["metadata"]["db-version"] == "0"
            assert get_local_db_version(USER, PROFILE) == 0
            assert has_sync_pending(USER), "the retry marker must survive so the write retries"


# ---------------------------------------------------------------------------
# 4. Design decision (b): an UNOPENABLE local DB refuses loudly, not by raising
# ---------------------------------------------------------------------------

class TestUnopenableDbRefusesLoudly:
    """T5920 round 2. If the local DB cannot be OPENED as SQLite (a corrupt/non-DB
    blob, or a path that exists() but sqlite3.connect() rejects), the guard maps it
    onto the SAME 3-state contract a busy checkpoint uses -- refuse (retryable
    FAILED), no upload -- instead of letting sqlite3.OperationalError escape the
    sync primitive and become a 500 in the request-thread callers. Per CLAUDE.md
    "No silent fallbacks for internal data" the refusal is LOUD, and it is
    distinguishable in the logs from a contended (busy) checkpoint."""

    def test_helper_returns_false_and_does_not_raise(self):
        """_checkpoint_wal_or_refuse never propagates the connect error."""
        from app.storage import _checkpoint_wal_or_refuse

        # A path whose parent directory does not exist -> sqlite3.connect raises
        # "unable to open database file". The helper must swallow it into False.
        bad = Path("/nonexistent-dir-t5920/profile.sqlite")
        assert _checkpoint_wal_or_refuse(bad, USER) is False

    def test_open_failure_logs_distinctly_from_busy(self, tmp_path, caplog):
        """The absent/unopenable case logs [SYNC_CHECKPOINT_OPEN_FAILED] with the
        path + user id, and NOT the [SYNC_CHECKPOINT_BUSY] marker -- an absent DB
        and a contended checkpoint are different problems."""
        import logging

        from app.storage import _checkpoint_wal_or_refuse

        bad = tmp_path / "profile.sqlite"  # exists() as a DIRECTORY -> connect fails
        bad.mkdir()

        with caplog.at_level(logging.ERROR, logger="app.storage"):
            assert _checkpoint_wal_or_refuse(bad, USER) is False

        text = caplog.text
        assert "SYNC_CHECKPOINT_OPEN_FAILED" in text
        assert "SYNC_CHECKPOINT_BUSY" not in text
        assert USER in text and str(bad) in text

    def test_primitive_refuses_instead_of_raising(self, tmp_path):
        """End to end: an unopenable local DB returns (False, None) from the upload
        primitive (SyncResult.FAILED), NOT an escaping exception. Guards the NEW
        failure mode that would otherwise 500 a request-thread caller."""
        from app.storage import sync_database_to_r2_with_version

        bad = tmp_path / "profile.sqlite"
        bad.mkdir()  # exists() True, but sqlite3.connect rejects it

        with patch("app.storage.R2_ENABLED", True), \
             patch("app.storage.get_r2_sync_client", return_value=object()), \
             patch("app.storage.r2_key", return_value="u/profile.sqlite"):
            success, version = sync_database_to_r2_with_version(
                USER, bad, current_version=1, skip_version_check=True,
            )

        assert success is False
        assert version is None
