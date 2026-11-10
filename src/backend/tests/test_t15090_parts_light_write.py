"""T15090: PATCH /parts is a light write, and resume rebuilds from R2 ListParts.

A resume-state save takes no per-user write lock and runs no R2 sync, so it can
never queue behind (or itself become) the in-lock retry of a deferred sync. That
leaves parts_json only local until the next synced write, so prepare's resume
reads completed parts from R2 ListParts rather than trusting parts_json.

Run with: pytest src/backend/tests/test_t15090_parts_light_write.py -v
"""
import asyncio
import contextlib
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import httpx
import pytest

from tests.test_t4050_durable_sync import FakeR2, _r2_patched

PROFILE = "abcd1234"
MB = 1024 * 1024
FILE_SIZE = 40 * 5 * MB
FIVE_MB = 5 * MB
GU = "app.routers.games_upload."


def _urls(key, upload_id, file_size, part_size, expires_in):
    return [{"part_number": i + 1, "url": "u"} for i in range(-(-file_size // part_size))]


def _hash():
    return uuid.uuid4().hex * 2


def _listing(*numbers):
    return [{"PartNumber": n, "Size": FIVE_MB, "ETag": f'"r2-{n}"'} for n in numbers]


def _parts(*numbers):
    return [{"part_number": n, "etag": f'"client-{n}"'} for n in numbers]


@contextlib.asynccontextmanager
async def _env():
    """Real middleware + real handlers against FakeR2, so the lock and sync seams run."""
    fake = FakeR2()
    user = "t15090" + uuid.uuid4().hex[:6]
    tmp = Path(tempfile.mkdtemp(prefix="t15090-"))
    failure_writer = MagicMock()
    list_parts = MagicMock(return_value=_listing(1))
    with contextlib.ExitStack() as stack:
        for p in (
            patch("app.database.USER_DATA_BASE", tmp),
            patch("app.database._initialized_users", set()),
            _r2_patched(fake),
            patch(GU + "R2_ENABLED", True),
            patch(GU + "r2_head_object_global", lambda k: None),
            patch(GU + "get_credit_balance", lambda u: {"balance": 10**9}),
            patch("app.analytics.record_milestone", lambda *a, **k: None),
            patch(GU + "generate_multipart_urls", _urls),
            patch(GU + "r2_create_multipart_upload", lambda k: "up-1"),
            patch(GU + "r2_abort_orphan_multipart_uploads", lambda *a, **k: 0),
            patch(GU + "r2_abort_multipart_upload", lambda *a, **k: True),
            patch(GU + "r2_is_multipart_upload_valid", lambda *a: True),
            patch("app.storage.r2_list_multipart_parts", list_parts),
            patch(GU + "record_upload_failure_from_payload", failure_writer),
        ):
            stack.enter_context(p)

        from app import session_init
        from app.database import (
            ensure_database,
            profile_db_path,
            set_local_db_version,
            set_local_user_db_version,
        )
        from app.main import app
        from app.profile_context import set_current_profile_id
        from app.services.user_db import ensure_user_database
        from app.user_context import set_current_user_id

        set_current_user_id(user)
        set_current_profile_id(PROFILE)
        ensure_user_database(user)
        ensure_database()
        set_local_db_version(user, PROFILE, 0)
        set_local_user_db_version(user, 0)
        session_init._profile_registry_cache[user] = frozenset({PROFILE})
        headers = {"X-User-ID": user, "X-Profile-ID": PROFILE}
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t",
                                     headers=headers, timeout=30) as client:
            yield SimpleNamespace(client=client, fake=fake, user=user, app=app,
                                  db=profile_db_path(user, PROFILE),
                                  failure_writer=failure_writer, list_parts=list_parts)
    session_init._profile_registry_cache.pop(user, None)
    shutil.rmtree(tmp, ignore_errors=True)


async def _settle(env):
    """Wait for prepare's background sync, so its pending_uploads row is on R2."""
    from app.database import has_sync_pending
    deadline = time.monotonic() + 10
    while has_sync_pending(env.user):
        assert time.monotonic() < deadline, "prepare's sync never settled"
        await asyncio.sleep(0.02)
    await asyncio.sleep(0.05)


async def _prepare(env, h):
    res = await env.client.post("/api/games/prepare-upload", json={
        "blake3_hash": h, "file_size": FILE_SIZE, "original_filename": "a.mp4", "kind": "game"})
    assert res.status_code == 200, res.text
    return res.json()


def _patch_parts(env, session_id, h, numbers):
    return env.client.patch(f"/api/games/upload/{session_id}/parts", json={
        "parts": _parts(*numbers), "kind": "game", "blake3_hash": h})


def _age_all_sessions(env):
    conn = sqlite3.connect(env.db)
    conn.execute("UPDATE pending_uploads SET last_part_at = datetime('now', '-300 seconds')")
    conn.commit()
    conn.close()


def _saved_parts(env, session_id):
    from app.utils.encoding import decode_data
    conn = sqlite3.connect(env.db)
    row = conn.execute("SELECT parts_json FROM pending_uploads WHERE id = ?", (session_id,)).fetchone()
    conn.close()
    return decode_data(row[0]) or []


def _lose_local_db(env):
    """A hard machine loss: the local file is gone and R2 is all that survives."""
    from app import database
    from app.database import ensure_database, set_local_db_version
    set_local_db_version(env.user, PROFILE, None)
    for suffix in ("", "-wal", "-shm"):
        Path(f"{env.db}{suffix}").unlink(missing_ok=True)
    database._initialized_users.discard(env.user)
    ensure_database()


@contextlib.contextmanager
def _sqlite_write_lock_held(env, seconds):
    """A worker thread holding SQLite's write lock, as a long write transaction does."""
    taken = threading.Event()

    def hold():
        conn = sqlite3.connect(env.db, check_same_thread=False)
        conn.execute("BEGIN IMMEDIATE")
        taken.set()
        time.sleep(seconds)
        conn.rollback()
        conn.close()

    thread = threading.Thread(target=hold)
    thread.start()
    assert taken.wait(5)
    try:
        yield
    finally:
        thread.join()


async def _max_loop_gap(awaitable):
    """Largest stall the event loop saw while `awaitable` ran."""
    gaps = []

    async def ticker():
        last = time.perf_counter()
        while True:
            await asyncio.sleep(0.01)
            now = time.perf_counter()
            gaps.append(now - last)
            last = now

    task = asyncio.create_task(ticker())
    await asyncio.sleep(0.03)
    try:
        result = await awaitable
    finally:
        task.cancel()
    return result, max(gaps)


@pytest.mark.asyncio
async def test_parts_save_completes_while_the_write_lock_is_held():
    """T15090:C1 - the save neither waits on nor logs against the per-user lock."""
    from app.middleware import db_sync
    async with _env() as env:
        h = _hash()
        session_id = (await _prepare(env, h))["upload_session_id"]
        await _settle(env)
        async with db_sync._get_user_write_lock(env.user):
            res = await asyncio.wait_for(_patch_parts(env, session_id, h, [1, 2]), timeout=3)
        assert res.status_code == 200
        assert res.json()["parts_count"] == 2


@pytest.mark.asyncio
async def test_parts_save_uploads_nothing_and_leaves_a_pending_marker_alone():
    """T15090:C1 - the save never becomes the in-lock retry of a deferred sync."""
    from app.database import get_local_db_version, has_sync_pending, mark_sync_pending
    from app.storage import DbWriteState, db_write_state
    async with _env() as env:
        h = _hash()
        session_id = (await _prepare(env, h))["upload_session_id"]
        await _settle(env)
        mark_sync_pending(env.user, PROFILE)
        version = get_local_db_version(env.user, PROFILE)
        with patch("app.middleware.db_sync.retry_pending_sync") as retry:
            uploads = len(env.fake.upload_calls)
            res = await _patch_parts(env, session_id, h, [1])
            await asyncio.sleep(0.2)
        assert res.status_code == 200
        retry.assert_not_called()
        assert len(env.fake.upload_calls) == uploads
        assert has_sync_pending(env.user)
        assert get_local_db_version(env.user, PROFILE) == version
        assert db_write_state(env.db) == DbWriteState.DIRTY


@pytest.mark.asyncio
async def test_resume_after_losing_the_local_db_keeps_every_part_r2_holds():
    """T15090:C2 - a crash costs nothing, even for parts no save ever recorded."""
    async with _env() as env:
        h = _hash()
        session_id = (await _prepare(env, h))["upload_session_id"]
        await _settle(env)
        await _patch_parts(env, session_id, h, list(range(1, 9)))
        _lose_local_db(env)
        _age_all_sessions(env)
        env.list_parts.return_value = _listing(*range(1, 11))

        resumed = await _prepare(env, h)

        assert resumed["is_resume"] is True
        assert resumed["completed_parts"] == [
            {"part_number": n, "etag": f'"r2-{n}"'} for n in range(1, 11)]
        assert [p["part_number"] for p in resumed["parts"]] == list(range(11, 41))


@pytest.mark.asyncio
async def test_resume_writes_the_listing_back_to_parts_json():
    """T15090:C2 - the pending tile's progress reads the same truth prepare returned."""
    async with _env() as env:
        h = _hash()
        session_id = (await _prepare(env, h))["upload_session_id"]
        await _settle(env)
        _age_all_sessions(env)
        env.list_parts.return_value = _listing(1, 2, 3)

        await _prepare(env, h)

        assert [p["part_number"] for p in _saved_parts(env, session_id)] == [1, 2, 3]


@pytest.mark.asyncio
async def test_resume_with_nothing_on_r2_starts_fresh():
    """T15090:C2 - an empty listing stays fail-closed (T7480), never a resume of nothing."""
    async with _env() as env:
        h = _hash()
        await _prepare(env, h)
        await _settle(env)
        _age_all_sessions(env)
        env.list_parts.return_value = []
        assert (await _prepare(env, h))["is_resume"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("request_fn", ["parts", "heartbeat"])
async def test_a_busy_sqlite_writer_does_not_freeze_the_event_loop(request_fn):
    """T15090:C1 - without the per-user lock a save can meet a busy DB; only its thread waits."""
    async with _env() as env:
        h = _hash()
        session_id = (await _prepare(env, h))["upload_session_id"]
        await _settle(env)
        if request_fn == "parts":
            call = _patch_parts(env, session_id, h, [1])
        else:
            call = env.client.post("/api/games/upload-heartbeat", json={"session_id": session_id})
        with _sqlite_write_lock_held(env, 0.8):
            res, gap = await _max_loop_gap(call)
        assert res.status_code in (200, 204)
        assert gap < 0.4, f"event loop stalled {gap:.2f}s behind a busy SQLite writer"


@pytest.mark.asyncio
async def test_concurrent_saves_lose_no_parts():
    """T15090:C1 - no lock serializes these now, so the merge must be atomic at the DB."""
    async with _env() as env:
        h = _hash()
        session_id = (await _prepare(env, h))["upload_session_id"]
        await _settle(env)
        results = await asyncio.gather(*(_patch_parts(env, session_id, h, [n]) for n in range(1, 21)))
        assert {r.status_code for r in results} == {200}
        assert [p["part_number"] for p in _saved_parts(env, session_id)] == list(range(1, 21))


@pytest.mark.asyncio
async def test_a_locked_db_answers_a_retryable_503():
    """T15090:C1 - lock contention past busy_timeout is reported, not swallowed."""
    from app.routers import games_upload
    real_connection = games_upload.get_db_connection

    class LockedOnBegin:
        def __init__(self, conn):
            self._conn = conn

        def __getattr__(self, name):
            return getattr(self._conn, name)

        def execute(self, sql, *args):
            if sql.startswith("BEGIN"):
                raise sqlite3.OperationalError("database is locked")
            return self._conn.execute(sql, *args)

    @contextlib.contextmanager
    def locked_connection():
        with real_connection() as conn:
            yield LockedOnBegin(conn)

    async with _env() as env:
        h = _hash()
        session_id = (await _prepare(env, h))["upload_session_id"]
        await _settle(env)
        with patch.object(games_upload, "get_db_connection", locked_connection):
            res = await _patch_parts(env, session_id, h, [1])
        assert res.status_code == 503


@pytest.mark.asyncio
async def test_missing_session_is_a_404_that_holds_no_sqlite_lock_during_the_failure_write():
    """T15090:C1 - the Postgres failure write runs after the transaction has closed."""
    async with _env() as env:
        await _settle(env)
        free_during_write = []

        def writer(payload):
            conn = sqlite3.connect(env.db, timeout=0)
            try:
                conn.execute("BEGIN IMMEDIATE")
                conn.rollback()
                free_during_write.append(True)
            except sqlite3.OperationalError:
                free_during_write.append(False)
            finally:
                conn.close()
            assert payload["terminal"] is False

        env.failure_writer.side_effect = writer
        res = await _patch_parts(env, "upload_missing", _hash(), [1])
        assert res.status_code == 404
        assert free_during_write == [True]


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", [
    ("DELETE", "/api/games/upload/upload_x"),
    ("POST", "/api/games/prepare-upload"),
])
async def test_other_upload_writes_still_take_the_write_lock(method, path):
    """T15090:C2 - only the resume-state save is light; these stay durable writes."""
    from app.middleware import db_sync
    async with _env() as env:
        await _settle(env)
        lock = db_sync._get_user_write_lock(env.user)
        await lock.acquire()
        task = asyncio.create_task(env.client.request(method, path, json={}))
        done, _pending = await asyncio.wait({task}, timeout=0.3)
        lock.release()
        assert not done, f"{method} {path} ran without the per-user write lock"
        await task


@pytest.mark.asyncio
async def test_finalize_still_takes_the_write_lock_for_its_own_write():
    """T15090:C2 / T15590: finalize is LAZY_WRITE_LOCK_ROUTES now (the R2 multipart-
    complete/HEAD calls run unlocked), but its own pending_uploads DELETE still takes
    the per-user write lock -- it never became a light write like PATCH /parts."""
    from app.middleware import db_sync
    GU = "app.routers.games_upload."
    async with _env() as env:
        h = _hash()
        session_id = (await _prepare(env, h))["upload_session_id"]
        await _settle(env)
        with patch(GU + "r2_complete_multipart_upload", lambda *a, **k: True), \
                patch(GU + "r2_head_object_global", lambda key: {"ContentLength": FILE_SIZE}):
            lock = db_sync._get_user_write_lock(env.user)
            await lock.acquire()
            task = asyncio.create_task(env.client.post("/api/games/finalize-upload", json={
                "upload_session_id": session_id, "parts": [{"part_number": 1, "etag": "e"}],
                "blake3_hash": h, "kind": "game"}))
            done, _pending = await asyncio.wait({task}, timeout=0.3)
            assert not done, "finalize's DELETE ran without the per-user write lock"
            lock.release()
            response = await task
            assert response.status_code == 200, response.text


def test_light_write_label_is_the_real_route():
    """T15090:C1 - a renamed route would silently fall back to the locked path."""
    from app.main import app
    from app.middleware.db_sync import RequestContextMiddleware
    from app.r2_usage import route_source

    def label(method, path):
        return route_source(app, {"type": "http", "method": method, "path": path,
                                  "root_path": "", "headers": [], "query_string": b""})

    light = RequestContextMiddleware.LIGHT_WRITE_ROUTES
    assert label("PATCH", "/api/games/upload/upload_abc/parts") in light
    assert label("DELETE", "/api/games/upload/upload_abc") not in light
