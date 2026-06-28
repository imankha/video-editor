"""
T4050 — Durable sync (sync-before-respond) for one-shot irreversible gestures.

The bug (confirmed on prod project 41): publish/edit/delete commit to the LOCAL
profile.sqlite and return 200, but the R2 upload is fire-and-forget AFTER the
response. If the machine is replaced (deploy/autostop/crash) or the 0.5s upload-
lock defer fires before that background task runs, the write never reaches R2 and
the next session_init pulls the stale pre-gesture snapshot back down — the action
silently reverts.

The fix (Option A): mark the three gestures durable via the `durable_sync`
dependency. RequestContextMiddleware then AWAITS the R2 sync INSIDE the still-held
per-user write lock (lock_timeout=None, never defers) and returns 503 instead of a
lying 200 when the sync fails.

These tests drive the REAL middleware end-to-end via httpx.ASGITransport (the
container's TestClient is incompatible) against an in-memory boto3-shaped R2. All
of storage.py's real logic runs against the fake — version metadata, the per-user
upload lock, conflict detection, archive msgpack, and ensure_database's download —
so the durability, lock, and version assertions exercise production code paths.

Tests:
  1. Machine-replacement durability (headline) — publish / edit / delete each
     survive a simulated machine swap from R2.
  2. Forced sync failure -> 503 keeps state (a 200 would have lied).
  3. Lock-defer no longer drops — durable publish blocks on the upload lock then
     succeeds; never returns 200-with-unsynced.
  4. No double-sync / version correctness — exactly one profile PutObject + one
     version bump per durable gesture.
  5. Excluded routes stay async — rename / watched don't block on R2 latency.
"""

import asyncio
import io
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from unittest.mock import patch

import httpx
import pytest
from botocore.exceptions import ClientError

# Reuse the round-trip harness's seed + connect helpers.
from tests.test_t4050_publish_restore_roundtrip import _connect, _seed_published_reel

USER_ID = "t4050dur"
PROFILE_ID = "abcd1234"  # 8 lowercase hex — passes the middleware X-Profile-ID regex
HEADERS = {"X-User-ID": USER_ID, "X-Profile-ID": PROFILE_ID}

PUBLISH_URL = "/api/downloads/publish/{pid}"
RESTORE_URL = "/api/downloads/{fid}/restore-project"
DELETE_URL = "/api/downloads/{fid}"
RENAME_URL = "/api/downloads/{fid}/name"
WATCHED_URL = "/api/downloads/{fid}/watched"


# ---------------------------------------------------------------------------
# In-memory boto3-shaped R2. The REAL storage.py functions run against this.
# ---------------------------------------------------------------------------

class _NoSuchKey(Exception):
    pass


class FakeR2:
    def __init__(self):
        self._objects = {}          # key -> {"data": bytes, "metadata": dict}
        self._lock = threading.Lock()
        self.upload_calls = []       # (op, key, db_version)
        self.download_calls = []     # (op, key)
        self.fail_profile_upload = False
        self.upload_latency = 0.0
        self.exceptions = type("exc", (), {"ClientError": ClientError, "NoSuchKey": _NoSuchKey})

    # --- assertion helpers ---
    def has(self, key):
        with self._lock:
            return key in self._objects

    def keys(self):
        with self._lock:
            return sorted(self._objects)

    def profile_uploads(self):
        return [c for c in self.upload_calls if c[1].endswith("profile.sqlite")]

    # --- boto3 surface ---
    def head_object(self, Bucket=None, Key=None):
        with self._lock:
            obj = self._objects.get(Key)
        if obj is None:
            raise ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
        return {"Metadata": dict(obj["metadata"])}

    def get_object(self, Bucket=None, Key=None):
        with self._lock:
            obj = self._objects.get(Key)
        if obj is None:
            raise _NoSuchKey(Key)
        return {"Body": io.BytesIO(obj["data"])}

    def _store(self, Key, data, ExtraArgs=None):
        meta = dict((ExtraArgs or {}).get("Metadata", {}))
        with self._lock:
            self._objects[Key] = {"data": bytes(data), "metadata": meta}

    def upload_file(self, Filename, Bucket, Key, ExtraArgs=None, Callback=None, Config=None):
        if self.upload_latency:
            time.sleep(self.upload_latency)
        if self.fail_profile_upload and Key.endswith("profile.sqlite"):
            raise ClientError({"Error": {"Code": "403", "Message": "forced failure"}}, "PutObject")
        with open(Filename, "rb") as f:
            data = f.read()
        self._store(Key, data, ExtraArgs)
        self.upload_calls.append(("upload_file", Key, dict((ExtraArgs or {}).get("Metadata", {})).get("db-version")))

    def upload_fileobj(self, Fileobj, Bucket, Key, ExtraArgs=None, Callback=None, Config=None):
        self._store(Key, Fileobj.read(), ExtraArgs)
        self.upload_calls.append(("upload_fileobj", Key, None))

    def download_file(self, Bucket, Key, Filename, ExtraArgs=None, Callback=None, Config=None):
        with self._lock:
            obj = self._objects.get(Key)
        if obj is None:
            raise _NoSuchKey(Key)
        os.makedirs(os.path.dirname(Filename), exist_ok=True)
        with open(Filename, "wb") as f:
            f.write(obj["data"])
        self.download_calls.append(("download_file", Key))

    def delete_object(self, Bucket=None, Key=None):
        with self._lock:
            self._objects.pop(Key, None)


@contextmanager
def _r2_patched(fake):
    """Turn R2 on across every module that copied the R2_ENABLED flag, and route
    all boto3 client getters at the fake. The real storage.py logic then runs."""
    with patch("app.storage.R2_ENABLED", True), \
         patch("app.database.R2_ENABLED", True), \
         patch("app.middleware.db_sync.R2_ENABLED", True), \
         patch("app.services.project_archive.R2_ENABLED", True), \
         patch("app.storage.get_r2_client", lambda: fake), \
         patch("app.storage.get_r2_sync_client", lambda: fake), \
         patch("app.storage.get_r2_transfer_client", lambda: fake), \
         patch("app.services.project_archive.get_r2_client", lambda: fake), \
         patch("app.routers.auth.mark_user_archived", lambda *a, **k: None):
        yield


@contextmanager
def _request_context():
    """Bind the profile/user ContextVars for direct (non-request) calls such as
    ensure_database after a simulated machine swap."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)
    yield


@pytest.fixture()
def dur_env(tmp_path):
    """Real per-user profile.sqlite under tmp_path + in-memory R2. Yields the
    FastAPI app, the fake R2, and the local db_path."""
    fake = FakeR2()
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         _r2_patched(fake):
        from app.main import app
        from app.database import ensure_database, get_database_path, set_local_db_version

        with _request_context():
            # R2 is empty -> ensure_database starts fresh and locks the version to 0,
            # so in-request ensure_database() calls don't re-download mid-test.
            ensure_database()
            db_path = get_database_path()
            set_local_db_version(USER_ID, PROFILE_ID, 0)

        yield app, fake, db_path


def _client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
        headers=HEADERS,
    )


def _simulate_machine_replacement(db_path):
    """Wipe everything a machine swap wipes: local version cache (profile + user)
    and the on-disk profile.sqlite (+ WAL sidecars). Only the fake R2 store
    survives — exactly the prod scenario."""
    from app.database import set_local_db_version, set_local_user_db_version
    set_local_db_version(USER_ID, PROFILE_ID, None)
    set_local_user_db_version(USER_ID, None)
    for suffix in ("", "-wal", "-shm"):
        p = db_path.parent / ("profile.sqlite" + suffix)
        if p.exists():
            p.unlink()


def _reload_from_r2():
    """Re-run the cold-start path that a fresh machine runs: ensure_database pulls
    profile.sqlite back down from R2."""
    from app.database import ensure_database
    with _request_context():
        ensure_database()


def _archive_key(project_id):
    from app.storage import r2_key
    with _request_context():
        return r2_key(USER_ID, f"archive/{project_id}.msgpack")


def _published_row(db_path, final_video_id):
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT published_at FROM final_videos WHERE id = ?", (final_video_id,)
    ).fetchone()
    conn.close()
    return row


def _archived_at(db_path, project_id):
    conn = _connect(db_path)
    row = conn.execute(
        "SELECT archived_at FROM projects WHERE id = ?", (project_id,)
    ).fetchone()
    conn.close()
    return row["archived_at"] if row else None


# ===========================================================================
# 1. HEADLINE — machine-replacement durability (mirrors prod project 41)
# ===========================================================================

@pytest.mark.asyncio
async def test_publish_survives_machine_replacement(dur_env):
    """Durable publish, then simulate a machine swap leaving only R2. The reel
    must STILL be published + archived and archive/{id}.msgpack must be present."""
    app, fake, db_path = dur_env
    project_id, final_video_id = _seed_published_reel(db_path)
    # Un-publish the seed so the publish gesture is the thing under test.
    conn = _connect(db_path)
    conn.execute("UPDATE final_videos SET published_at = NULL WHERE id = ?", (final_video_id,))
    conn.commit()
    conn.close()

    async with _client(app) as c:
        resp = await c.post(PUBLISH_URL.format(pid=project_id))
    assert resp.status_code == 200, resp.text
    assert resp.json()["archived"] is True

    _simulate_machine_replacement(db_path)
    _reload_from_r2()

    assert _published_row(db_path, final_video_id)["published_at"] is not None, \
        "publish reverted after machine replacement — durable sync did not reach R2"
    assert _archived_at(db_path, project_id) is not None, "archived_at reverted"
    assert fake.has(_archive_key(project_id)), "archive msgpack missing from R2"


@pytest.mark.asyncio
async def test_restore_edit_survives_machine_replacement(dur_env):
    """Durable restore-project (Edit) must survive a machine swap: the reel stays
    UNPUBLISHED and the working data stays restored."""
    app, fake, db_path = dur_env
    from app.routers.downloads import publish_to_my_reels

    project_id, final_video_id = _seed_published_reel(db_path)
    # Set up the published+archived state directly (msgpack lands in fake R2).
    with _request_context():
        await publish_to_my_reels(project_id)
    assert _published_row(db_path, final_video_id)["published_at"] is not None

    async with _client(app) as c:
        resp = await c.post(RESTORE_URL.format(fid=final_video_id))
    assert resp.status_code == 200, resp.text

    _simulate_machine_replacement(db_path)
    _reload_from_r2()

    assert _published_row(db_path, final_video_id)["published_at"] is None, \
        "restore (unpublish) reverted after machine replacement"
    assert _archived_at(db_path, project_id) is None, "archived_at not cleared after restore"
    conn = _connect(db_path)
    wc = conn.execute(
        "SELECT COUNT(*) c FROM working_clips WHERE project_id = ?", (project_id,)
    ).fetchone()["c"]
    conn.close()
    assert wc > 0, "working data was not restored durably"


@pytest.mark.asyncio
async def test_delete_survives_machine_replacement(dur_env):
    """Durable delete must survive a machine swap: the reel stays deleted."""
    app, fake, db_path = dur_env
    from app.routers.downloads import publish_to_my_reels

    project_id, final_video_id = _seed_published_reel(db_path)
    with _request_context():
        await publish_to_my_reels(project_id)

    async with _client(app) as c:
        resp = await c.delete(DELETE_URL.format(fid=final_video_id))
    assert resp.status_code == 200, resp.text

    _simulate_machine_replacement(db_path)
    _reload_from_r2()

    assert _published_row(db_path, final_video_id) is None, \
        "deleted reel reappeared after machine replacement — delete did not reach R2"


# ===========================================================================
# 2. Forced sync failure -> 503 keeps state (a 200 would have lied)
# ===========================================================================

@pytest.mark.asyncio
async def test_forced_sync_failure_returns_503_and_state_is_not_durable(dur_env):
    """When the R2 profile upload fails, durable publish returns 503 sync_failed.
    After a machine swap the reel is NOT published — proving a 200 would lie."""
    app, fake, db_path = dur_env
    project_id, final_video_id = _seed_published_reel(db_path)
    conn = _connect(db_path)
    conn.execute("UPDATE final_videos SET published_at = NULL WHERE id = ?", (final_video_id,))
    conn.commit()
    conn.close()

    fake.fail_profile_upload = True
    async with _client(app) as c:
        resp = await c.post(PUBLISH_URL.format(pid=project_id))

    assert resp.status_code == 503, resp.text
    body = resp.json()
    assert body["code"] == "sync_failed"
    assert body["retryable"] is True

    # The committed-locally publish never reached R2; after a swap it's gone.
    # profile.sqlite never uploaded, so the fresh machine downloads nothing and
    # rebuilds an empty DB — the reel row itself is absent (not merely unpublished).
    _simulate_machine_replacement(db_path)
    _reload_from_r2()
    row = _published_row(db_path, final_video_id)
    assert row is None or row["published_at"] is None, \
        "503 path must NOT be durable — a 200 here would have silently reverted"


# ===========================================================================
# 3. Lock-defer no longer drops — blocks then succeeds, never 200-with-unsynced
# ===========================================================================

@pytest.mark.asyncio
async def test_durable_publish_blocks_on_upload_lock_then_succeeds(dur_env):
    """Hold the per-user profile upload lock. A durable publish must BLOCK on it
    (lock_timeout=None — never the 0.5s silent defer), then succeed once released,
    with the write actually in R2."""
    app, fake, db_path = dur_env
    from app.storage import get_upload_lock

    project_id, final_video_id = _seed_published_reel(db_path)
    conn = _connect(db_path)
    conn.execute("UPDATE final_videos SET published_at = NULL WHERE id = ?", (final_video_id,))
    conn.commit()
    conn.close()

    lock = get_upload_lock(USER_ID, "profile")
    assert lock.acquire(timeout=1), "could not pre-acquire upload lock"
    try:
        async with _client(app) as c:
            task = asyncio.create_task(c.post(PUBLISH_URL.format(pid=project_id)))
            await asyncio.sleep(0.3)
            assert not task.done(), \
                "durable publish returned while the upload lock was held — it deferred " \
                "instead of blocking (the 200-with-unsynced loss path)"
            # Release the lock so the blocked upload thread can proceed.
            lock.release()
            resp = await task
    finally:
        if lock.locked():
            lock.release()

    assert resp.status_code == 200, resp.text
    # Proof it actually synced rather than deferring.
    from app.storage import r2_key
    with _request_context():
        key = r2_key(USER_ID, "profile.sqlite")
    assert fake.has(key), "profile.sqlite never reached R2 despite a 200"


# ===========================================================================
# 4. No double-sync / version correctness (guards the Option-B regression)
# ===========================================================================

@pytest.mark.asyncio
async def test_durable_publish_syncs_profile_exactly_once(dur_env):
    """Exactly one profile PutObject and exactly one version bump (0 -> 1) per
    durable gesture."""
    app, fake, db_path = dur_env
    from app.database import get_local_db_version

    project_id, final_video_id = _seed_published_reel(db_path)
    conn = _connect(db_path)
    conn.execute("UPDATE final_videos SET published_at = NULL WHERE id = ?", (final_video_id,))
    conn.commit()
    conn.close()

    assert get_local_db_version(USER_ID, PROFILE_ID) == 0
    async with _client(app) as c:
        resp = await c.post(PUBLISH_URL.format(pid=project_id))
    assert resp.status_code == 200, resp.text

    profile_uploads = fake.profile_uploads()
    assert len(profile_uploads) == 1, f"expected exactly one profile upload, got {profile_uploads}"
    assert profile_uploads[0][2] == "1", f"expected db-version 1, got {profile_uploads[0][2]}"
    assert get_local_db_version(USER_ID, PROFILE_ID) == 1, "local version not advanced exactly once"


# ===========================================================================
# 5. Excluded routes stay async — they don't block on R2 latency
# ===========================================================================

@pytest.mark.asyncio
async def test_excluded_writes_stay_async_under_r2_latency(dur_env):
    """Non-durable writes (rename, mark-watched) must return immediately even when
    the R2 upload is slow — their sync is fire-and-forget, not awaited."""
    app, fake, db_path = dur_env
    from app.routers.downloads import publish_to_my_reels

    project_id, final_video_id = _seed_published_reel(db_path)
    with _request_context():
        await publish_to_my_reels(project_id)

    fake.upload_latency = 1.0  # every R2 upload now takes ~1s
    async with _client(app) as c:
        t0 = time.perf_counter()
        r_name = await c.patch(RENAME_URL.format(fid=final_video_id), json={"name": "Renamed"})
        rename_ms = (time.perf_counter() - t0) * 1000
        # Drain the rename's fire-and-forget sync (holds the upload lock ~1s) so the
        # next request measures its OWN latency, not contention with the prior sync.
        await asyncio.sleep(1.3)

        t1 = time.perf_counter()
        r_watch = await c.patch(WATCHED_URL.format(fid=final_video_id))
        watch_ms = (time.perf_counter() - t1) * 1000

    assert r_name.status_code == 200, r_name.text
    assert r_watch.status_code == 200, r_watch.text
    assert rename_ms < 500, f"rename blocked on R2 ({rename_ms:.0f}ms) — should be async"
    assert watch_ms < 500, f"watched blocked on R2 ({watch_ms:.0f}ms) — should be async"

    # Let the dangling background sync drain so it doesn't bleed into teardown.
    await asyncio.sleep(1.3)
