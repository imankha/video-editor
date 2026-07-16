"""T5195 — quest_2 gains a `return_home` first step (before the framing tutorial).

After saving their first reel in Annotate, a first-run user must return to the
home (games) screen to pick the reel and start framing. `return_home` guides
them: it completes on the `returned_home` achievement (fired when the user
lands on the home screen after saving a reel — gated client-side on
annotate_brilliant so the app's default landing doesn't pre-complete it) and
backfills from "any framing export exists": a user who has begun framing was
necessarily home first, mirroring add_clip's backfill.

Tests call the internal quest logic directly (TestClient is avoided here due to
an httpx/starlette version mismatch in this environment — same pattern as
test_rate_clip_step.py / test_tutorial_quest_steps.py).
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

TEST_USER_ID = f"test_return_home_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault_return_home"

# Pre-populate init cache so middleware takes the fast path (no DB opens)
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

QUEST_2_EXPECTED_STEPS = [
    "return_home",
    "watch_framing_tutorial",
    "open_framing",
    "position_crop",
    "add_slowmo",
    "export_framing",
    "wait_for_export",
]


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
        conn.execute("DELETE FROM achievements WHERE key = 'returned_home'")
        conn.execute("DELETE FROM export_jobs")
        conn.commit()


def _record_returned_home():
    with get_db_connection() as conn:
        conn.execute("INSERT OR IGNORE INTO achievements (key) VALUES ('returned_home')")
        conn.commit()


def _make_framing_export(status="pending"):
    with get_db_connection() as conn:
        conn.execute(
            "INSERT INTO export_jobs (id, type, status, input_data) VALUES (?, 'framing', ?, X'00')",
            (uuid.uuid4().hex, status),
        )
        conn.commit()


def test_quest_2_has_seven_steps_with_return_home_first():
    """quest_2 gains return_home as its FIRST step, before the framing tutorial."""
    q2 = quest_config.QUEST_BY_ID["quest_2"]
    assert q2["step_ids"] == QUEST_2_EXPECTED_STEPS
    assert q2["step_ids"][0] == "return_home"
    assert q2["step_ids"][1] == "watch_framing_tutorial"
    # Reward unchanged (per-quest, not per-step)
    assert q2["reward"] == 25


def test_returned_home_is_known_and_stepped():
    """The nav gesture's achievement key is accepted AND read by step computation."""
    # Must be in KNOWN_ACHIEVEMENT_KEYS or POST /achievements/returned_home 400s.
    assert "returned_home" in KNOWN_ACHIEVEMENT_KEYS
    # Must be in the batched step query or _check_all_steps never sees it.
    assert "returned_home" in _STEP_ACHIEVEMENT_KEYS


def test_return_home_completes_on_returned_home():
    """With no framing yet, return_home is False until returned_home is recorded."""
    with get_db_connection() as conn:
        before = _check_all_steps(TEST_USER_ID, conn)
    assert before["return_home"] is False

    _record_returned_home()

    with get_db_connection() as conn:
        after = _check_all_steps(TEST_USER_ID, conn)
    assert after["return_home"] is True
    # The nav achievement does NOT complete any framing step.
    assert after["open_framing"] is False
    assert after["export_framing"] is False


def test_return_home_backfills_from_framing_export():
    """Any framing export completes return_home even without the achievement.

    A user who has begun framing was necessarily on the home screen first, so a
    framing export_jobs row (any status) is proof the step was satisfied.
    """
    _make_framing_export(status="pending")  # no returned_home recorded

    with get_db_connection() as conn:
        steps = _check_all_steps(TEST_USER_ID, conn)
    assert steps["return_home"] is True
    # export_framing is satisfied by the same row; wait_for_export needs 'complete'.
    assert steps["export_framing"] is True
    assert steps["wait_for_export"] is False


def test_claimed_quest_2_renders_all_seven_steps():
    """A pre-existing claimed quest_2 renders fully complete after the new step.

    Self-heal (quests.py): any quest in the user-scoped completed set renders all
    of ITS CURRENT step_ids True — so adding return_home cannot un-complete a
    quest the user already finished and claimed.
    """
    from app.services.user_db import mark_quest_completed

    # No achievements, no exports — derived steps would be incomplete...
    mark_quest_completed(TEST_USER_ID, "quest_2")
    try:
        result = asyncio.run(get_progress())
        q2 = next(q for q in result["quests"] if q["id"] == "quest_2")
        assert q2["completed"] is True
        assert q2["reward_claimed"] is True
        assert set(q2["steps"].keys()) == set(QUEST_2_EXPECTED_STEPS)
        assert all(q2["steps"].values()), q2["steps"]
    finally:
        # Clean up the user.sqlite row so reruns start fresh.
        from app.services.user_db import get_user_db_connection
        with get_user_db_connection(TEST_USER_ID) as conn:
            conn.execute("DELETE FROM completed_quests WHERE quest_id = 'quest_2'")
            conn.commit()
