"""T6270 — POST /quests/achievements/{key} returns the updated progress.

Every achievement POST used to be chased by a GET /quests/progress. The write
already mutates progress server-side, so the POST now folds the updated progress
into its own response body (additively) and the client drops the follow-up GET.

Tests call the internal quest handlers directly (TestClient is avoided here due
to an httpx/starlette version mismatch in this environment — same pattern as
test_return_home_step.py / test_tutorial_quest_steps.py).
"""

import asyncio
import uuid

import pytest

from app.database import get_db_connection
from app.profile_context import set_current_profile_id
from app.routers.quests import get_progress, record_achievement
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_USER_ID = f"test_ach_progress_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault_ach_progress"

# Pre-populate init cache so middleware takes the fast path (no DB opens)
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


@pytest.fixture(autouse=True)
def _ctx():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _clean()
    yield
    _clean()


def _clean():
    with get_db_connection() as conn:
        conn.execute(
            "DELETE FROM achievements WHERE key IN ('opened_framing_editor', 'opened_overlay_editor')"
        )
        conn.commit()


def _steps_for(payload, quest_id):
    quest = next(q for q in payload["quests"] if q["id"] == quest_id)
    return quest["steps"]


def test_post_response_is_backward_compatible():
    """Existing key/achieved_at fields are preserved (additive change)."""
    res = asyncio.run(record_achievement("opened_framing_editor"))
    assert res["key"] == "opened_framing_editor"
    assert res["achieved_at"] is not None


def test_post_returns_progress_reflecting_the_write():
    """The POST body carries the same {"quests": [...]} shape as GET /progress,
    with the just-recorded step already flipped True."""
    res = asyncio.run(record_achievement("opened_framing_editor"))

    assert "progress" in res
    assert "quests" in res["progress"]
    # open_framing (quest_2) is derived purely from opened_framing_editor.
    assert _steps_for(res["progress"], "quest_2")["open_framing"] is True


def test_post_progress_matches_standalone_get():
    """POST-embedded progress and the standalone GET agree — the client can rely
    on the POST body in place of the follow-up GET."""
    post_res = asyncio.run(record_achievement("opened_overlay_editor"))
    get_res = asyncio.run(get_progress())

    assert post_res["progress"]["quests"] == get_res["quests"]
    # The written step is reflected in both.
    assert _steps_for(post_res["progress"], "quest_3")["open_overlay"] is True
    assert _steps_for(get_res, "quest_3")["open_overlay"] is True
