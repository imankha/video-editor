"""T15150: a durable write releases the per-user write lock before its R2 sync.

Finalize-upload and activate held the lock across their durable sync (2-5 s on dev), so a
second upload finishing at the same moment waited for the whole of the first, and a prepare
arriving then waited too. The lock now covers the handler, the pending marker and the
sync-attempt registration; the sync itself serialises on the per-key upload lock
(storage.get_upload_lock, T6402), and the response still waits for it (T4320, T4050).

R2 PUTs are gated with an Event, so the headline assertion does not depend on timing.

Run with: pytest src/backend/tests/test_t15150_durable_sync_off_lock.py -v
"""
import asyncio
import contextlib
import logging
import re
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from tests.test_t15090_lock_queue import (
    _env_with_user_db,
    _finalize,
    _gate_uploads,
    _pending_rows_on_r2,
    _puts,
    _quiet,
    _r2_key,
)
from tests.test_t15090_parts_light_write import FILE_SIZE, GU, PROFILE, _hash, _prepare, _settle


@contextlib.contextmanager
def _seams():
    """Every finalize that reaches R2's complete call records its key in `completed`."""
    completed = []
    pg = MagicMock()

    @contextlib.contextmanager
    def fake_pg():
        yield pg

    def complete(key, *args, **kwargs):
        completed.append(key)
        return True

    with patch("app.analytics.get_pg", fake_pg), \
            patch(GU + "r2_complete_multipart_upload", complete), \
            patch(GU + "r2_head_object_global",
                  lambda key: {"ContentLength": FILE_SIZE} if key in completed else None):
        yield completed


async def _until(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(0.01)
    return True


async def _idle(env):
    """Wait for every sync thread, not for a clean marker: a non-durable write landing
    while two durable uploads queue defers on the upload lock, and the T5870 re-drain
    gives up before they finish (pre-existing; healed by the next write)."""
    from app.middleware.db_sync import is_sync_attempt_in_progress
    assert await _until(lambda: not is_sync_attempt_in_progress(env.user), timeout=15), "syncs never idle"


async def _two_sessions(env):
    h1, h2 = _hash(), _hash()
    s1 = (await _prepare(env, h1))["upload_session_id"]
    s2 = (await _prepare(env, h2))["upload_session_id"]
    await _settle(env)
    return (s1, h1), (s2, h2)


def _lock_waits(caplog):
    return [(r.getMessage().split(" user=")[0].split("] ", 1)[1], int(m.group(1)))
            for r in caplog.records
            if (m := re.search(r"\[WRITE_LOCK_WAIT\].*waited_ms=(\d+)", r.getMessage()))]


@pytest.mark.asyncio
async def test_second_finalize_runs_its_handler_while_the_first_sync_is_in_flight(tmp_path):
    """The first finalize's PUT is held shut; the second must still reach its handler."""
    async with _env_with_user_db() as env:
        with _seams() as completed:
            (s1, h1), (s2, h2) = await _two_sessions(env)
            gate, stats = _gate_uploads(env.fake)
            gate.clear()
            first = asyncio.create_task(_finalize(env, s1, h1))
            assert await _until(lambda: "profile.sqlite" in stats.started), "first never synced"

            second = asyncio.create_task(_finalize(env, s2, h2))
            second_reached_r2 = await _until(lambda: len(completed) == 2, timeout=3)
            first_still_open = not first.done()

            gate.set()
            first_response, second_response = await asyncio.gather(first, second)
            puts_at_response = len(stats.started)
            await _quiet(env)

            assert second_reached_r2, "the second finalize waited for the first's R2 sync"
            assert first_still_open, "finalize returned before R2 confirmed its write (T4320)"
            assert first_response.status_code == 200, first_response.text
            assert second_response.status_code == 200, second_response.text
            assert all(peak == 1 for peak in stats.peak.values()), stats.peak
            assert len(stats.started) == puts_at_response, "a redundant upload ran after the responses"
            assert _pending_rows_on_r2(env, tmp_path) == 0, "a finalize's commit is not on R2"


@pytest.mark.asyncio
async def test_write_lock_wait_is_bounded_by_the_handler_not_the_sync(caplog):
    """Acceptance: with a 2.5 s R2, a finalize and a prepare arriving during another
    finalize's durable sync wait under 2 s for the write lock."""
    caplog.set_level(logging.INFO, logger="app.middleware.db_sync")
    async with _env_with_user_db() as env:
        with _seams():
            (s1, h1), (s2, h2) = await _two_sessions(env)
            _gate, stats = _gate_uploads(env.fake)
            env.fake.upload_latency = 2.5
            first = asyncio.create_task(_finalize(env, s1, h1))
            assert await _until(lambda: "profile.sqlite" in stats.started), "first never synced"

            second = asyncio.create_task(_finalize(env, s2, h2))
            prepare = asyncio.create_task(_prepare(env, _hash()))
            first_response, second_response, _ = await asyncio.gather(first, second, prepare)
            await _idle(env)

    assert first_response.status_code == 200, first_response.text
    assert second_response.status_code == 200, second_response.text
    waits = _lock_waits(caplog)
    assert max((ms for _route, ms in waits), default=0) < 2000, waits


@pytest.mark.asyncio
async def test_finalize_still_answers_503_when_its_sync_fails():
    """Off the lock, the response still waits for R2: a failed PUT is a retryable 503."""
    from app.database import has_sync_pending_scope
    async with _env_with_user_db() as env:
        with _seams():
            (s1, h1), _ = await _two_sessions(env)
            env.fake.fail_profile_upload = True

            response = await _finalize(env, s1, h1)

            assert response.status_code == 503, response.text
            body = response.json()
            assert body["code"] == "sync_failed"
            assert body["retryable"] is True
            assert body["sync_state"] == "failed"
            assert has_sync_pending_scope(env.user, PROFILE), "a failed durable write lost its marker"


@pytest.mark.asyncio
async def test_finalize_still_freezes_on_a_cas_conflict(caplog):
    """Off the lock, a foreign writer ahead on R2 is still refused: no PUT, conflict
    marker, CRITICAL log, 503 with Retry."""
    from app.database import has_sync_conflict, has_sync_pending_scope
    caplog.set_level(logging.WARNING)
    async with _env_with_user_db() as env:
        with _seams():
            (s1, h1), _ = await _two_sessions(env)
            env.fake._objects[_r2_key(env, "profile.sqlite")]["metadata"]["db-version"] = "999"
            before = _puts(env, "profile.sqlite")

            response = await _finalize(env, s1, h1)

            assert response.status_code == 503, response.text
            assert response.json()["sync_state"] == "conflict"
            assert has_sync_conflict(env.user)
            assert has_sync_pending_scope(env.user, PROFILE), "a conflict must keep its marker"
            assert _puts(env, "profile.sqlite") == before, "a stale copy reached R2"
            assert any(r.levelname == "CRITICAL" and "SYNC_CONFLICT" in r.getMessage()
                       for r in caplog.records)
