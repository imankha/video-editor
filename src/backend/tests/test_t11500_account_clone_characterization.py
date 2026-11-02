"""T11500 Step 2a: characterization of copy_user_between_envs BEFORE the move into
app/services/account_clone.py. Written against the unmodified script and green
there; must stay green after the mechanical move (the script re-imports the moved
names, so `cu.*` keeps resolving).

Pins: copy_r2_objects mirror/purge/empty-source refusal, verify_r2_copy
pass/fail, and the game_storage_refs re-key block in copy_postgres_rows.
Failures are asserted through a helper that accepts SystemExit (pre-2c) or
AccountCloneError (post-2c) so the SAME tests characterize both sides of the move.
"""
import sys
import uuid
from pathlib import Path

import psycopg2
import pytest
from psycopg2.extras import RealDictCursor

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))

import copy_user_between_envs as cu

from tests.conftest import register_test_user_ids

BUCKET = "bucket"
UID = "aaaaaaaa-1111-2222-3333-444455556666"


def _failure_types():
    try:
        from app.services.account_clone import AccountCloneError
        return (SystemExit, AccountCloneError)
    except ImportError:
        return (SystemExit,)


class FakeR2:
    def __init__(self, objects=None, versions=None):
        self.objects = dict(objects or {})
        self.versions = dict(versions or {})
        self.copied = []
        self.drop_on_copy = set()

    def get_paginator(self, _name):
        objs = self.objects

        class _P:
            def paginate(self, Bucket=None, Prefix=""):
                yield {"Contents": [{"Key": k} for k in sorted(objs) if k.startswith(Prefix)]}

        return _P()

    def copy_object(self, Bucket, Key, CopySource):
        src = CopySource["Key"]
        self.copied.append((src, Key))
        if src in self.drop_on_copy:
            return
        self.objects[Key] = self.objects[src]
        if src in self.versions:
            self.versions[Key] = self.versions[src]

    def delete_objects(self, Bucket, Delete):
        for o in Delete["Objects"]:
            self.objects.pop(o["Key"], None)
            self.versions.pop(o["Key"], None)

    def download_file(self, Bucket, Key, Filename):
        Path(Filename).write_bytes(self.objects[Key])

    def head_object(self, Bucket=None, Key=None):
        if Key not in self.objects:
            raise KeyError(Key)
        return {"Metadata": {"db-version": self.versions.get(Key, "1")}}


def _seed_profile_sqlite(tmp_path):
    import sqlite3
    db = tmp_path / "p.sqlite"
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE final_videos (id INTEGER PRIMARY KEY, filename TEXT, poster_filename TEXT)")
    c.execute("CREATE TABLE working_videos (id INTEGER PRIMARY KEY, filename TEXT)")
    c.commit()
    c.close()
    b = db.read_bytes()
    db.unlink()
    return b


def _src_objects(tmp_path):
    p = f"dev/users/{UID}"
    return {
        f"{p}/user.sqlite": b"u",
        f"{p}/profiles/p1/profile.sqlite": _seed_profile_sqlite(tmp_path),
        f"{p}/profiles/p1/raw_clips/a.mp4": b"a",
    }


def test_copy_r2_objects_mirrors_all_keys_and_purges_stale_destination(tmp_path, monkeypatch):
    objs = _src_objects(tmp_path)
    dst_uid = "bbbbbbbb-1111-2222-3333-444455556666"
    objs[f"dev/users/{dst_uid}/stale.bin"] = b"stale"
    r2 = FakeR2(objs, versions={f"dev/users/{UID}/user.sqlite": "7",
                                f"dev/users/{UID}/profiles/p1/profile.sqlite": "9"})
    monkeypatch.setattr(cu, "get_r2_client", lambda cfg: r2)
    cu.copy_r2_objects({"R2_BUCKET": BUCKET}, UID, "dev", "dev", False, dst_uid)
    dst = {k for k in r2.objects if k.startswith(f"dev/users/{dst_uid}/")}
    assert dst == {
        f"dev/users/{dst_uid}/user.sqlite",
        f"dev/users/{dst_uid}/profiles/p1/profile.sqlite",
        f"dev/users/{dst_uid}/profiles/p1/raw_clips/a.mp4",
    }
    assert f"dev/users/{dst_uid}/stale.bin" not in r2.objects
    # source untouched
    assert len([k for k in r2.objects if k.startswith(f"dev/users/{UID}/")]) == 3
    assert r2.versions[f"dev/users/{dst_uid}/user.sqlite"] == "7"


def test_copy_r2_objects_refuses_empty_source_without_purging_destination(monkeypatch):
    dst_uid = "bbbbbbbb-1111-2222-3333-444455556666"
    r2 = FakeR2({f"dev/users/{dst_uid}/keep.bin": b"k"})
    monkeypatch.setattr(cu, "get_r2_client", lambda cfg: r2)
    with pytest.raises(_failure_types()):
        cu.copy_r2_objects({"R2_BUCKET": BUCKET}, UID, "dev", "dev", False, dst_uid)
    assert f"dev/users/{dst_uid}/keep.bin" in r2.objects


def test_copy_r2_objects_dry_run_writes_nothing(tmp_path, monkeypatch):
    r2 = FakeR2(_src_objects(tmp_path))
    monkeypatch.setattr(cu, "get_r2_client", lambda cfg: r2)
    before = dict(r2.objects)
    cu.copy_r2_objects({"R2_BUCKET": BUCKET}, UID, "dev", "dev", True, "bbbbbbbb-0")
    assert r2.objects == before and r2.copied == []


def test_verify_r2_copy_passes_on_faithful_mirror(tmp_path):
    objs = _src_objects(tmp_path)
    src_keys = sorted(objs)
    dst_uid = "cccc"
    r2 = FakeR2(objs)
    for k in src_keys:
        r2.objects[k.replace(UID, dst_uid)] = objs[k]
    cu.verify_r2_copy(r2, BUCKET, UID, "dev", "dev", src_keys, dst_uid)


def test_verify_r2_copy_fails_on_missing_extra_and_version_mismatch(tmp_path):
    objs = _src_objects(tmp_path)
    src_keys = sorted(objs)
    dst_uid = "cccc"

    def mirror():
        r2 = FakeR2(objs)
        for k in src_keys:
            r2.objects[k.replace(UID, dst_uid)] = objs[k]
        return r2

    r2 = mirror()
    del r2.objects[f"dev/users/{dst_uid}/user.sqlite"]
    with pytest.raises(_failure_types()):
        cu.verify_r2_copy(r2, BUCKET, UID, "dev", "dev", src_keys, dst_uid)

    r2 = mirror()
    r2.objects[f"dev/users/{dst_uid}/extra.bin"] = b"x"
    with pytest.raises(_failure_types()):
        cu.verify_r2_copy(r2, BUCKET, UID, "dev", "dev", src_keys, dst_uid)

    r2 = mirror()
    r2.versions[f"dev/users/{UID}/user.sqlite"] = "1"
    r2.versions[f"dev/users/{dst_uid}/user.sqlite"] = "2"
    with pytest.raises(_failure_types()):
        cu.verify_r2_copy(r2, BUCKET, UID, "dev", "dev", src_keys, dst_uid)


def test_copy_postgres_rows_rekeys_game_storage_refs(pg_conn, monkeypatch):
    """The refs block re-keys user_id, keeps profile_id/hash/size/expiry."""
    suffix = uuid.uuid4().hex[:8]
    src_id = f"t11500-src-{suffix}"
    src_email = f"t11500-src-{suffix}@example.test"
    dst_email = f"t11500-dst-{suffix}@example.test"
    dst_id = cu.alias_user_id(src_id, dst_email)
    register_test_user_ids(src_id, dst_id)
    dsn = pg_conn
    c = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    cur = c.cursor()
    cur.execute("INSERT INTO users (user_id, email) VALUES (%s, %s)", (src_id, src_email))
    cur.execute(
        "INSERT INTO game_storage_refs (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at) "
        "VALUES (%s, 'p1', %s, 1234, '2099-12-31T00:00:00+00:00'), (%s, 'p2', %s, 99, '2098-01-01T00:00:00+00:00')",
        (src_id, "h" * 8 + suffix, src_id, "g" * 8 + suffix),
    )
    c.commit()
    c.close()
    # FINDING (pre-existing, NOT fixed by this task's move): an alias copy INTO THE
    # SAME Postgres collides on users.email_unsubscribe_token (UNIQUE, added by v037
    # after T7800), because the script only neutralizes google_id/invite_code. The
    # proxy below gives the alias row a fresh token so this test can characterize the
    # refs block in isolation; the production script is left untouched.
    class _Cur:
        def __init__(self, cur):
            self._c = cur

        def execute(self, sql, params=None):
            if sql.startswith("INSERT INTO users") and params:
                cols = [x.strip() for x in sql.split("(", 1)[1].split(")", 1)[0].split(",")]
                if "email_unsubscribe_token" in cols:
                    params = list(params)
                    params[cols.index("email_unsubscribe_token")] = str(uuid.uuid4())
            return self._c.execute(sql, params)

        def __getattr__(self, n):
            return getattr(self._c, n)

    class _Conn:
        def __init__(self, conn):
            self._conn = conn

        def cursor(self):
            return _Cur(self._conn.cursor())

        def __getattr__(self, n):
            return getattr(self._conn, n)

    monkeypatch.setattr(cu, "get_pg_conn",
                        lambda cfg: _Conn(psycopg2.connect(dsn, cursor_factory=RealDictCursor)))
    got_src, got_dst = cu.copy_postgres_rows({}, {}, src_email, False, dst_email)
    assert (got_src, got_dst) == (src_id, dst_id)
    c = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    cur = c.cursor()
    cur.execute("SELECT profile_id, blake3_hash, game_size_bytes, storage_expires_at "
                "FROM game_storage_refs WHERE user_id = %s ORDER BY profile_id", (dst_id,))
    rows = cur.fetchall()
    cur.execute("SELECT profile_id, blake3_hash, game_size_bytes, storage_expires_at "
                "FROM game_storage_refs WHERE user_id = %s ORDER BY profile_id", (src_id,))
    src_rows = cur.fetchall()
    c.close()
    assert len(rows) == 2 and rows == src_rows
    assert rows[0]["game_size_bytes"] == 1234 and rows[0]["profile_id"] == "p1"


def test_copy_user_objects_copies_concurrently_and_fails_loud_on_any_error(monkeypatch):
    """A real fixture clone is ~630 objects at ~1.4 s per CopyObject: serial took ~15 min per
    clone (first live builder run). Copies must overlap, and one failed copy must still raise."""
    import threading
    import time

    from app.services import account_clone as ac

    class SlowR2(FakeR2):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.lock = threading.Lock()
            self.inflight = 0
            self.max_inflight = 0
            self.fail_key = None

        def copy_object(self, Bucket, Key, CopySource):
            with self.lock:
                self.inflight += 1
                self.max_inflight = max(self.max_inflight, self.inflight)
            try:
                time.sleep(0.02)
                if CopySource["Key"] == self.fail_key:
                    raise RuntimeError("copy boom")
                with self.lock:
                    super().copy_object(Bucket, Key, CopySource)
            finally:
                with self.lock:
                    self.inflight -= 1

    # The verify steps have their own tests; here only the copy loop is under test.
    monkeypatch.setattr(ac, "verify_r2_copy", lambda *a, **k: None)
    monkeypatch.setattr(ac, "verify_media_refs", lambda *a, **k: None)
    src = {f"dev/users/{UID}/profiles/p1/raw_clips/c{i}.mp4": b"x" for i in range(40)}

    r2 = SlowR2(src)
    ac.copy_user_objects(r2, BUCKET, UID, "dev", "dev", False, "dst-uid")
    assert r2.max_inflight > 1
    assert {k for k in r2.objects if k.startswith("dev/users/dst-uid/")} == {
        k.replace(f"dev/users/{UID}/", "dev/users/dst-uid/") for k in src}

    r2 = SlowR2(src)
    r2.fail_key = sorted(src)[7]
    with pytest.raises(RuntimeError, match="copy boom"):
        ac.copy_user_objects(r2, BUCKET, UID, "dev", "dev", False, "dst-uid")
