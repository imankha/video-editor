"""T5150 — the annotate step is split into rate_clip + annotate_brilliant (Save).

quest_1 gains a new `rate_clip` step between `add_clip` and `annotate_brilliant`.
It completes on the `clip_rated` achievement (fired on the rating gesture) and
backfills from "a reel exists" — you cannot save a reel without rating a clip,
so an existing reel is proof the rate step was satisfied. `annotate_brilliant`
keeps its old trigger (a reel exists) unchanged.

Tests call the internal quest logic directly (TestClient is avoided here due to an
httpx/starlette version mismatch in this environment — same pattern as
test_tutorial_quest_steps.py).
"""

import asyncio
import uuid

import pytest

from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app import quest_config
from app.database import get_db_connection
from app.routers.quests import (
    _check_all_steps,
    KNOWN_ACHIEVEMENT_KEYS,
    _STEP_ACHIEVEMENT_KEYS,
    get_progress,
)

TEST_USER_ID = f"test_rate_clip_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault_rate_clip"

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
    """Reset the profile data this test file touches."""
    with get_db_connection() as conn:
        conn.execute("DELETE FROM achievements WHERE key = 'clip_rated'")
        conn.execute("DELETE FROM raw_clips")
        conn.execute("DELETE FROM projects")
        conn.commit()


def _record_clip_rated():
    with get_db_connection() as conn:
        conn.execute("INSERT OR IGNORE INTO achievements (key) VALUES ('clip_rated')")
        conn.commit()


def _make_reel_clip():
    """Insert a raw_clip that belongs to an auto-created reel (auto_project_id set)."""
    with get_db_connection() as conn:
        cur = conn.execute(
            "INSERT INTO projects (name, aspect_ratio, is_auto_created) VALUES ('r', '9:16', 1)"
        )
        project_id = cur.lastrowid
        conn.execute(
            "INSERT INTO raw_clips (filename, rating, tags, my_athlete, auto_project_id) "
            "VALUES ('', 5, NULL, 1, ?)",
            (project_id,),
        )
        conn.commit()


def test_quest_1_has_six_steps_with_rate_clip():
    """quest_1 gains rate_clip between add_clip and annotate_brilliant."""
    q1 = quest_config.QUEST_BY_ID["quest_1"]
    assert q1["step_ids"] == [
        "watch_annotate_tutorial",
        "upload_game",
        "add_clip",
        "rate_clip",
        "annotate_brilliant",
        "playback_annotations",
    ]
    # rate_clip sits directly between add_clip and annotate_brilliant
    ids = q1["step_ids"]
    assert ids.index("rate_clip") == ids.index("add_clip") + 1
    assert ids.index("annotate_brilliant") == ids.index("rate_clip") + 1
    # Reward unchanged
    assert q1["reward"] == 15


def test_clip_rated_is_known_and_stepped():
    """The rate gesture's achievement key is accepted AND read by step computation."""
    # Must be in KNOWN_ACHIEVEMENT_KEYS or POST /achievements/clip_rated 400s.
    assert "clip_rated" in KNOWN_ACHIEVEMENT_KEYS
    # Must be in the batched step query or _check_all_steps never sees it.
    assert "clip_rated" in _STEP_ACHIEVEMENT_KEYS


def test_rate_clip_completes_on_clip_rated():
    """With no reel yet, rate_clip is False until clip_rated is recorded."""
    with get_db_connection() as conn:
        before = _check_all_steps(TEST_USER_ID, conn)
    assert before["rate_clip"] is False
    # annotate_brilliant is independent and also False (no reel yet)
    assert before["annotate_brilliant"] is False

    _record_clip_rated()

    with get_db_connection() as conn:
        after = _check_all_steps(TEST_USER_ID, conn)
    assert after["rate_clip"] is True
    # Rating a clip does NOT complete the Save step — they stay independent.
    assert after["annotate_brilliant"] is False


def test_rate_clip_backfills_from_existing_reel():
    """A saved reel completes rate_clip even without the clip_rated achievement."""
    _make_reel_clip()  # no clip_rated recorded

    with get_db_connection() as conn:
        steps = _check_all_steps(TEST_USER_ID, conn)
    assert steps["rate_clip"] is True
    # The Save step (unchanged trigger) is also satisfied by the reel.
    assert steps["annotate_brilliant"] is True


def test_annotate_brilliant_trigger_unchanged():
    """annotate_brilliant still gates purely on 'a reel exists' (T5150 left it alone)."""
    # A clip_rated achievement with no reel must NOT complete annotate_brilliant.
    _record_clip_rated()
    with get_db_connection() as conn:
        steps = _check_all_steps(TEST_USER_ID, conn)
    assert steps["annotate_brilliant"] is False


def test_claimed_quest_1_renders_all_six_steps():
    """A pre-existing claimed quest_1 renders fully complete after the split.

    Self-heal (quests.py): any quest in the user-scoped completed set renders all
    of ITS CURRENT step_ids True — so adding rate_clip cannot un-complete a quest
    the user already finished and claimed.
    """
    from app.services.user_db import mark_quest_completed

    # No achievements, no reels — derived steps would be incomplete...
    mark_quest_completed(TEST_USER_ID, "quest_1")
    try:
        result = asyncio.run(get_progress())
        q1 = next(q for q in result["quests"] if q["id"] == "quest_1")
        assert q1["completed"] is True
        assert q1["reward_claimed"] is True
        assert set(q1["steps"].keys()) == {
            "watch_annotate_tutorial", "upload_game", "add_clip",
            "rate_clip", "annotate_brilliant", "playback_annotations",
        }
        assert all(q1["steps"].values()), q1["steps"]
    finally:
        # Clean up the user.sqlite row so reruns start fresh.
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection(TEST_USER_ID) as conn:
            conn.execute("DELETE FROM completed_quests WHERE quest_id = 'quest_1'")
            conn.commit()
