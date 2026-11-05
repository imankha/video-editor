"""T15140: a flow that failed releases its own session.

Its last_part_at stays fresh after the failure, so without a release the Retry that
follows within IN_FLIGHT_WINDOW_SECONDS read `in_progress` and waited on itself.

Run with: pytest src/backend/tests/test_t15140_upload_release.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from tests.test_t15090_parts_light_write import _env, _hash, _patch_parts, _prepare, _settle


async def _started_session(env, h):
    session_id = (await _prepare(env, h))["upload_session_id"]
    await _settle(env)
    await _patch_parts(env, session_id, h, [1])
    return session_id


@pytest.mark.asyncio
async def test_prepare_right_after_a_release_resumes_instead_of_waiting():
    async with _env() as env:
        h = _hash()
        session_id = await _started_session(env, h)

        await env.client.post("/api/games/upload-release", json={"session_id": session_id})
        retry = await _prepare(env, h)

        assert retry["status"] == "upload_required"
        assert retry["is_resume"] is True
        assert retry["upload_session_id"] == session_id


@pytest.mark.asyncio
async def test_a_heartbeat_after_a_release_makes_the_session_live_again():
    """Two flows can share a session: the survivor's next ping must win."""
    async with _env() as env:
        h = _hash()
        session_id = await _started_session(env, h)

        await env.client.post("/api/games/upload-release", json={"session_id": session_id})
        await env.client.post("/api/games/upload-heartbeat", json={"session_id": session_id})

        assert (await _prepare(env, h))["status"] == "in_progress"


@pytest.mark.asyncio
async def test_without_a_release_a_live_session_still_answers_in_progress():
    """Regression: the release is the only thing that may skip the guard."""
    async with _env() as env:
        h = _hash()
        await _started_session(env, h)
        assert (await _prepare(env, h))["status"] == "in_progress"


def test_release_path_skips_sync_and_write_lock():
    from app.middleware.db_sync import RequestContextMiddleware
    assert "/api/games/upload-release" in RequestContextMiddleware.SKIP_SYNC_PATHS
