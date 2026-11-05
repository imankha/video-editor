"""T15080: a waiting flow's in_progress answers must do no side-effect work.

A flow waiting on another flow's live upload used to re-POST prepare-upload
every 5 s; each POST booked a *_upload_attempted milestone, ran an R2 HEAD and a
Postgres balance read, and held the per-user write lock. Now:
  - prepare-upload answers in_progress BEFORE the milestone / HEAD / balance, and
  - the wait loop polls a read-only GET /upload-status (no write lock).

Run with: pytest src/backend/tests/test_t15080_in_progress_poll_side_effects.py -v
"""
import sys
import uuid
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from app.routers import games_upload

TEST_USER_ID = None
TEST_PROFILE_ID = "cd34ef56"
TWELVE_MB = 12 * 1024 * 1024


def setup_module():
    global TEST_USER_ID
    TEST_USER_ID = f"test_t15080_{uuid.uuid4().hex[:8]}"
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    import shutil

    from app.database import USER_DATA_BASE
    from app.user_context import reset_user_id
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


def _urls(**kwargs):
    return [{"part_number": n, "url": f"https://r2/{n}"} for n in (1, 2, 3)]


def _req(h):
    return games_upload.PrepareUploadRequest(
        blake3_hash=h, file_size=TWELVE_MB, original_filename="clip.mp4")


def _hash():
    return uuid.uuid4().hex + uuid.uuid4().hex[:32]


def _age_session(session_id: str, seconds: int):
    from app.database import get_db_connection
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE pending_uploads SET last_part_at = datetime('now', ?) WHERE id = ?",
            (f"-{seconds} seconds", session_id))
        conn.commit()


class _Spies:
    def __init__(self):
        self.milestone = MagicMock()
        self.head = MagicMock(return_value=None)
        self.balance = MagicMock(return_value={"balance": 10**9})

    def reset(self):
        for m in (self.milestone, self.head, self.balance):
            m.reset_mock()

    def attempted(self):
        return [c for c in self.milestone.call_args_list if c.args[1].endswith("_upload_attempted")]


async def _run(spies, coro_fn):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with ExitStack() as stack:
        for p in (
            patch("app.routers.games_upload.R2_ENABLED", True),
            patch("app.routers.games_upload.r2_head_object_global", spies.head),
            patch("app.routers.games_upload.get_credit_balance", spies.balance),
            patch("app.analytics.record_milestone", spies.milestone),
            patch("app.routers.games_upload.calculate_upload_cost", return_value=1),
            patch("app.routers.games_upload.generate_multipart_urls", side_effect=_urls),
            patch("app.routers.games_upload.r2_create_multipart_upload", return_value="upload-id-1"),
            patch("app.routers.games_upload.r2_abort_orphan_multipart_uploads", return_value=0),
            patch("app.routers.games_upload.r2_is_multipart_upload_valid", return_value=True),
            patch("app.storage.r2_list_multipart_parts", return_value=[{"PartNumber": 1, "Size": 5 * 1024 * 1024, "ETag": "e1"}]),
        ):
            stack.enter_context(p)
        return await coro_fn()


async def _live_session(h):
    first = await games_upload.prepare_upload(_req(h))
    assert first["status"] == "upload_required"
    await games_upload.save_upload_parts(
        first["upload_session_id"],
        games_upload.SavePartsRequest(parts=[games_upload.PartInfo(part_number=1, etag="e1")]))
    return first


@pytest.mark.asyncio
async def test_n_in_progress_prepares_then_resume_book_exactly_one_attempt():
    h = _hash()
    spies = _Spies()

    async def body():
        first = await _live_session(h)
        spies.reset()  # the owning flow's own attempt is not the waiting flow's
        answers = [await games_upload.prepare_upload(_req(h)) for _ in range(5)]
        in_progress_side_effects = (len(spies.attempted()), spies.head.call_count, spies.balance.call_count)
        _age_session(first["upload_session_id"], games_upload.IN_FLIGHT_WINDOW_SECONDS + 30)
        resumed = await games_upload.prepare_upload(_req(h))
        return answers, in_progress_side_effects, resumed

    answers, in_progress_side_effects, resumed = await _run(spies, body)
    assert [a["status"] for a in answers] == ["in_progress"] * 5
    # milestone, R2 HEAD, Postgres balance: none on an in_progress answer
    assert in_progress_side_effects == (0, 0, 0)
    assert resumed["status"] == "upload_required" and resumed["is_resume"] is True
    assert len(spies.attempted()) == 1


@pytest.mark.asyncio
async def test_upload_status_reports_live_session_without_side_effects():
    h = _hash()
    spies = _Spies()

    async def body():
        first = await _live_session(h)
        spies.reset()
        live = await games_upload.upload_status(blake3_hash=h, kind="game", file_size=TWELVE_MB)
        _age_session(first["upload_session_id"], games_upload.IN_FLIGHT_WINDOW_SECONDS + 30)
        quiet = await games_upload.upload_status(blake3_hash=h, kind="game", file_size=TWELVE_MB)
        none = await games_upload.upload_status(blake3_hash=_hash(), kind="game", file_size=TWELVE_MB)
        return first, live, quiet, none

    first, live, quiet, none = await _run(spies, body)
    assert live["status"] == "in_progress"
    assert live["upload_session_id"] == first["upload_session_id"]
    assert live["progress_percent"] == pytest.approx(100 / 3, abs=1)
    assert quiet == {"status": "idle"}
    assert none == {"status": "idle"}
    assert spies.milestone.call_count == spies.head.call_count == spies.balance.call_count == 0


def test_upload_status_is_a_get_so_it_takes_no_write_lock():
    from app.middleware.db_sync import WRITE_METHODS
    routes = [r for r in games_upload.router.routes if r.path == "/api/games/upload-status"]
    assert len(routes) == 1
    assert routes[0].methods == {"GET"}
    assert not (routes[0].methods & WRITE_METHODS)
