"""T15090: no write waits on another write's R2 sync.

Live run, 2026-11-05: finalize-upload took 28.3 s and telemetry queued for 30 s. A
write marks .sync_pending before its own sync starts, so the next write read every
healthy in-flight upload as abandoned and re-uploaded the DB inside the per-user lock.

R2 PUTs are gated with an Event, so the headline assertions do not depend on timing.

Run with: pytest src/backend/tests/test_t15090_lock_queue.py -v
"""
import asyncio
import contextlib
import logging
import re
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from tests.test_t15090_parts_light_write import FILE_SIZE, GU, PROFILE, _env, _hash, _prepare, _settle

IMPRESSIONS = 5


@contextlib.asynccontextmanager
async def _env_with_user_db():
    """_env() leaves app.services.user_db on the real data dir, which makes every
    user.sqlite sync a silent no-op. Point both modules at one directory."""
    tmp = Path(tempfile.mkdtemp(prefix="t15090q-"))
    with patch("tests.test_t15090_parts_light_write.tempfile",
               SimpleNamespace(mkdtemp=lambda prefix: str(tmp))), \
            patch("app.services.user_db.USER_DATA_BASE", tmp):
        async with _env() as env:
            yield env
    shutil.rmtree(tmp, ignore_errors=True)


def _gate_uploads(fake):
    """Hold every PUT until the gate opens; count per-key concurrency."""
    gate = threading.Event()
    gate.set()
    stats = SimpleNamespace(current={}, peak={}, started=[])
    guard = threading.Lock()
    real_upload = fake.upload_file

    def gated(Filename, Bucket, Key, ExtraArgs=None, **kwargs):
        with guard:
            stats.current[Key] = stats.current.get(Key, 0) + 1
            stats.peak[Key] = max(stats.peak.get(Key, 0), stats.current[Key])
            stats.started.append(Key.rsplit("/", 1)[-1])
        try:
            assert gate.wait(20), "gate never opened"
            return real_upload(Filename, Bucket, Key, ExtraArgs=ExtraArgs, **kwargs)
        finally:
            with guard:
                stats.current[Key] -= 1

    fake.upload_file = gated
    return gate, stats


@contextlib.contextmanager
def _finalize_seams(entered):
    """`entered` fires when finalize's handler reaches R2's complete call."""
    pg = MagicMock()

    @contextlib.contextmanager
    def fake_pg():
        yield pg

    def complete(*args, **kwargs):
        entered.set()
        return True

    with patch("app.analytics.get_pg", fake_pg), \
            patch(GU + "r2_complete_multipart_upload", complete), \
            patch(GU + "r2_head_object_global",
                  lambda key: {"ContentLength": FILE_SIZE} if entered.is_set() else None):
        yield


def _impression(env, n):
    return env.client.post("/api/telemetry/impression", json={"kind": "capability", "name": f"p{n}"})


def _finalize(env, session_id, h):
    return env.client.post("/api/games/finalize-upload", json={
        "upload_session_id": session_id, "parts": [{"part_number": 1, "etag": "e"}],
        "blake3_hash": h, "kind": "game"})


def _beacon_writes_user_db(env):
    """A locked write that dirties user.sqlite, as impressions did before this fix."""
    def write(payload):
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection(env.user) as conn:
            conn.execute("INSERT INTO user_action_log (action, context, created_at) VALUES ('x', '{}', 't')")
            conn.commit()
    env.failure_writer.side_effect = write


def _beacon(env):
    return env.client.post("/api/games/upload-failure-beacon", json={"phase": "uploading", "reason": "y"})


def _puts(env, name):
    return len([call for call in env.fake.upload_calls if call[1].endswith(name)])


async def _quiet(env):
    from app.database import has_sync_pending
    from app.middleware.db_sync import is_sync_attempt_in_progress
    deadline = time.monotonic() + 15
    while has_sync_pending(env.user) or is_sync_attempt_in_progress(env.user):
        assert time.monotonic() < deadline, "syncs never settled"
        await asyncio.sleep(0.02)
    await asyncio.sleep(0.1)


def _r2_key(env, name):
    return next(key for key in sorted(env.fake._objects) if key.endswith(name))


def _pending_rows_on_r2(env, tmp_path):
    key = _r2_key(env, "profile.sqlite")
    copy = tmp_path / "r2-profile.sqlite"
    copy.write_bytes(env.fake._objects[key]["data"])
    conn = sqlite3.connect(copy)
    try:
        return conn.execute("SELECT COUNT(*) FROM pending_uploads").fetchone()[0]
    finally:
        conn.close()


@pytest.mark.asyncio
async def test_finalize_and_telemetry_do_not_queue_behind_an_upload_in_flight(tmp_path):
    entered = threading.Event()
    async with _env_with_user_db() as env:
        with _finalize_seams(entered):
            h = _hash()
            session_id = (await _prepare(env, h))["upload_session_id"]
            await _settle(env)
            _beacon_writes_user_db(env)
            gate, stats = _gate_uploads(env.fake)
            gate.clear()
            assert (await _beacon(env)).status_code == 204
            while "user.sqlite" not in stats.started:  # that sync is now stuck in flight
                await asyncio.sleep(0.01)

            impressions = [asyncio.create_task(_impression(env, n)) for n in range(IMPRESSIONS)]
            await asyncio.sleep(0.05)
            finalize = asyncio.create_task(_finalize(env, session_id, h))
            reached_handler = await asyncio.to_thread(entered.wait, 3.0)
            await asyncio.wait(impressions, timeout=3)
            impressions_done = sum(task.done() for task in impressions)
            held_open = not finalize.done()

            gate.set()
            response = await finalize
            started_at_response = len(stats.started)
            await asyncio.gather(*impressions)
            await _quiet(env)

            assert reached_handler, "finalize stuck behind R2 before its handler"
            assert impressions_done == IMPRESSIONS
            assert held_open, "finalize returned before R2 confirmed its write (T4320)"
            assert response.status_code == 200, response.text
            assert all(peak == 1 for peak in stats.peak.values()), stats.peak
            assert len(stats.started) == started_at_response, "a redundant upload ran after finalize"
            assert _pending_rows_on_r2(env, tmp_path) == 0, "finalize's commit is not on R2"


@pytest.mark.asyncio
async def test_lock_wait_stays_under_two_seconds_with_a_two_second_r2(caplog):
    caplog.set_level(logging.INFO, logger="app.middleware.db_sync")
    entered = threading.Event()
    async with _env_with_user_db() as env:
        with _finalize_seams(entered):
            h = _hash()
            session_id = (await _prepare(env, h))["upload_session_id"]
            await _settle(env)
            _beacon_writes_user_db(env)
            env.fake.upload_latency = 2.0
            assert (await _beacon(env)).status_code == 204
            impressions = [asyncio.create_task(_impression(env, n)) for n in range(IMPRESSIONS)]
            await asyncio.sleep(0.05)
            started = time.perf_counter()
            finalize = asyncio.create_task(_finalize(env, session_id, h))
            await asyncio.to_thread(entered.wait, 60)
            to_handler = time.perf_counter() - started
            response = await finalize
            await asyncio.gather(*impressions)
            await _quiet(env)

    assert response.status_code == 200
    assert to_handler < 2.0
    waits = [int(m.group(1)) for r in caplog.records
             if (m := re.search(r"\[WRITE_LOCK_WAIT\].*waited_ms=(\d+)", r.getMessage()))]
    assert max(waits, default=0) < 2000, waits


@pytest.mark.asyncio
async def test_abandoned_marker_on_the_scope_finalize_writes_uploads_exactly_once():
    from app.database import mark_sync_pending
    async with _env_with_user_db() as env:
        with _finalize_seams(threading.Event()):
            h = _hash()
            session_id = (await _prepare(env, h))["upload_session_id"]
            await _settle(env)
            before = _puts(env, "profile.sqlite")
            mark_sync_pending(env.user, PROFILE)

            response = await _finalize(env, session_id, h)
            assert response.status_code == 200, response.text
            await _quiet(env)

            assert _puts(env, "profile.sqlite") - before == 1


@pytest.mark.asyncio
async def test_abandoned_marker_on_another_scope_still_drains_once():
    from app.database import USER_DB_SCOPE, has_sync_pending, mark_sync_pending
    async with _env_with_user_db() as env:
        with _finalize_seams(threading.Event()):
            h = _hash()
            session_id = (await _prepare(env, h))["upload_session_id"]
            await _settle(env)
            mark_sync_pending(env.user, USER_DB_SCOPE)
            before = _puts(env, "user.sqlite")

            response = await _finalize(env, session_id, h)
            assert response.status_code == 200, response.text
            await _quiet(env)

            assert _puts(env, "user.sqlite") - before == 1
            assert not has_sync_pending(env.user)


@pytest.mark.asyncio
async def test_a_cas_conflict_found_by_the_drain_stays_fail_loud(caplog):
    from app.database import USER_DB_SCOPE, has_sync_conflict, has_sync_pending_scope, mark_sync_pending
    caplog.set_level(logging.WARNING)
    async with _env_with_user_db() as env:
        with _finalize_seams(threading.Event()):
            _beacon_writes_user_db(env)
            await _beacon(env)
            await _quiet(env)
            env.fake._objects[_r2_key(env, "user.sqlite")]["metadata"]["db-version"] = "999"
            env.failure_writer.side_effect = None
            before = _puts(env, "user.sqlite")
            mark_sync_pending(env.user, USER_DB_SCOPE)

            assert (await _beacon(env)).status_code == 204
            deadline = time.monotonic() + 5
            while not has_sync_conflict(env.user) and time.monotonic() < deadline:
                await asyncio.sleep(0.02)

            assert has_sync_conflict(env.user)
            assert has_sync_pending_scope(env.user, USER_DB_SCOPE), "a conflict must keep its marker"
            assert _puts(env, "user.sqlite") == before, "a stale copy reached R2"
            assert any(r.levelname == "CRITICAL" and "SYNC_CONFLICT" in r.getMessage() for r in caplog.records)


@pytest.mark.asyncio
async def test_finalize_does_not_copy_the_object_onto_itself():
    """The copy cost 1.3 s in the lock, and REPLACE wiped the object's Content-Type, so
    every game video served with none. Nothing reads the metadata it wrote."""
    async with _env_with_user_db() as env:
        env.fake.copy_object = MagicMock(return_value={})
        with _finalize_seams(threading.Event()):
            h = _hash()
            session_id = (await _prepare(env, h))["upload_session_id"]
            await _settle(env)

            response = await _finalize(env, session_id, h)

            assert response.status_code == 200, response.text
            env.fake.copy_object.assert_not_called()


def test_analytics_only_routes_skip_the_lock_and_the_sync():
    from app.middleware.db_sync import RequestContextMiddleware
    assert "/api/telemetry/" in RequestContextMiddleware.SKIP_SYNC_PATHS
    assert "/api/client-errors/" in RequestContextMiddleware.SKIP_SYNC_PATHS
