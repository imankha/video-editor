"""T15040: prepare-upload must not hand a LIVE session to a second flow.

A session whose /parts saw activity inside IN_FLIGHT_WINDOW_SECONDS is being
uploaded right now; a second prepare for the same hash+kind answers
`in_progress` (no presigned URLs) so the client waits instead of re-sending the
same bytes. A quiet session is a crash and resumes exactly as before.

Run with: pytest src/backend/tests/test_t15040_prepare_in_flight_guard.py -v
"""
import sys
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.routers import games_upload

TEST_USER_ID = None
TEST_PROFILE_ID = "ab12cd34"
TWELVE_MB = 12 * 1024 * 1024


def setup_module():
    global TEST_USER_ID
    TEST_USER_ID = f"test_t15040_{uuid.uuid4().hex[:8]}"
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    import shutil

    from app.database import USER_DATA_BASE
    from app.profile_context import set_current_profile_id
    from app.user_context import reset_user_id, set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


def _urls(**kwargs):
    return [{"part_number": n, "url": f"https://r2/{n}"} for n in (1, 2, 3)]


def _patches():
    return (
        patch("app.routers.games_upload.R2_ENABLED", True),
        patch("app.routers.games_upload.r2_head_object_global", return_value=None),
        patch("app.routers.games_upload.get_credit_balance", return_value={"balance": 10**9}),
        patch("app.routers.games_upload.calculate_upload_cost", return_value=1),
        patch("app.routers.games_upload.generate_multipart_urls", side_effect=_urls),
        patch("app.routers.games_upload.r2_create_multipart_upload", return_value="upload-id-1"),
        patch("app.routers.games_upload.r2_abort_orphan_multipart_uploads", return_value=0),
        patch("app.routers.games_upload.r2_is_multipart_upload_valid", return_value=True),
        patch("app.storage.r2_list_multipart_parts", return_value=[{"PartNumber": 1, "Size": 5 * 1024 * 1024, "ETag": "e1"}]),
    )


def _req(h):
    return games_upload.PrepareUploadRequest(
        blake3_hash=h, file_size=TWELVE_MB, original_filename="clip.mp4")


def _age_session(session_id: str, seconds: int):
    from app.database import get_db_connection
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE pending_uploads SET last_part_at = datetime('now', ?) WHERE id = ?",
            (f"-{seconds} seconds", session_id))
        conn.commit()


async def _prepare_with_saved_part(h):
    first = await games_upload.prepare_upload(_req(h))
    assert first["status"] == "upload_required"
    await games_upload.save_upload_parts(
        first["upload_session_id"],
        games_upload.SavePartsRequest(parts=[games_upload.PartInfo(part_number=1, etag="e1")]))
    return first


async def _run(coro_fn):
    from contextlib import ExitStack

    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with ExitStack() as stack:
        for p in _patches():
            stack.enter_context(p)
        return await coro_fn()


@pytest.mark.asyncio
async def test_prepare_on_recently_active_session_returns_in_progress():
    h = uuid.uuid4().hex + uuid.uuid4().hex[:32]

    async def body():
        first = await _prepare_with_saved_part(h)
        second = await games_upload.prepare_upload(_req(h))
        return first, second

    first, second = await _run(body)
    assert second["status"] == "in_progress"
    assert second["upload_session_id"] == first["upload_session_id"]
    assert second["progress_percent"] == pytest.approx(100 / 3, abs=1)
    assert "parts" not in second


@pytest.mark.asyncio
async def test_prepare_on_quiet_session_still_resumes():
    h = uuid.uuid4().hex + uuid.uuid4().hex[:32]

    async def body():
        first = await _prepare_with_saved_part(h)
        _age_session(first["upload_session_id"], games_upload.IN_FLIGHT_WINDOW_SECONDS + 30)
        return first, await games_upload.prepare_upload(_req(h))

    _first, second = await _run(body)
    assert second["status"] == "upload_required"
    assert second["is_resume"] is True
    assert [p["part_number"] for p in second["parts"]] == [2, 3]


# T15130: a live slow upload saves rarely (every 8 parts / at the end), so the
# save stamp alone ages out of the window. The client heartbeat keeps it live.
@pytest.mark.asyncio
async def test_heartbeat_keeps_session_live_when_last_save_is_older_than_window():
    h = uuid.uuid4().hex + uuid.uuid4().hex[:32]

    async def body():
        first = await _prepare_with_saved_part(h)
        _age_session(first["upload_session_id"], games_upload.IN_FLIGHT_WINDOW_SECONDS + 30)
        await games_upload.upload_heartbeat(
            games_upload.HeartbeatRequest(session_id=first["upload_session_id"]))
        return first, await games_upload.prepare_upload(_req(h))

    first, second = await _run(body)
    assert second["status"] == "in_progress"
    assert second["upload_session_id"] == first["upload_session_id"]
    assert "parts" not in second


@pytest.mark.asyncio
async def test_no_heartbeat_and_no_save_for_window_resumes():
    h = uuid.uuid4().hex + uuid.uuid4().hex[:32]

    async def body():
        first = await _prepare_with_saved_part(h)
        _age_session(first["upload_session_id"], games_upload.IN_FLIGHT_WINDOW_SECONDS + 30)
        return await games_upload.prepare_upload(_req(h))

    second = await _run(body)
    assert second["status"] == "upload_required"
    assert second["is_resume"] is True


def test_heartbeat_path_skips_sync_and_write_lock():
    from app.middleware.db_sync import RequestContextMiddleware
    assert "/api/games/upload-heartbeat" in RequestContextMiddleware.SKIP_SYNC_PATHS
