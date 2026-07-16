"""T5170 — the two spotlight-render steps move from Publish (quest_4) to the end
of Configure Your Spotlight (quest_3).

    OLD                                    NEW
    quest_3 [tutorial, open, players,      quest_3 [...same 5..., export_overlay,
             color, shape]                          wait_for_overlay]
    quest_4 [tutorial, export_overlay,     quest_4 [tutorial, move_to_my_reels,
             wait_for_overlay, move,                view_gallery_video]
             view]

No quest id or reward changes. The render steps are derived from the export_jobs
overlay aggregate in _check_all_steps, keyed by STEP ID (not by quest), so the
triggers keep firing after the move with zero trigger changes.

Migration-edge tests below prove NO reconciliation migration is needed: the
progress endpoint's self-heal renders every step of an already-claimed quest
True regardless of derived state, so moving steps INTO quest_3 cannot un-claim a
finished quest, and moving steps OUT of quest_4 cannot un-complete it. See
docs/plans/tasks/nuf-quest-fixes/T5170-move-render-steps-to-overlay-quest.md for
the full in-flight-population analysis.

Tests call the internal quest logic directly (TestClient avoided due to an
httpx/starlette version mismatch in this environment).
"""

import asyncio
import uuid

import pytest

from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app import quest_config
from app.database import get_db_connection
from app.routers.quests import _check_all_steps, get_progress, claim_reward

TEST_USER_ID = f"test_overlay_move_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault_overlay_move"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

RENDER_STEPS = ["export_overlay", "wait_for_overlay"]


@pytest.fixture(autouse=True)
def _ctx():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _clean()
    yield
    _clean()
    _clean_user_db()


def _clean():
    with get_db_connection() as conn:
        conn.execute("DELETE FROM export_jobs")
        conn.commit()


def _clean_user_db():
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(TEST_USER_ID) as conn:
        conn.execute("DELETE FROM completed_quests WHERE quest_id IN ('quest_3', 'quest_4')")
        conn.execute("DELETE FROM credit_transactions WHERE source = 'quest_reward'")
        conn.commit()


def _add_overlay_job(status: str):
    with get_db_connection() as conn:
        conn.execute(
            "INSERT INTO export_jobs (id, type, status, input_data) VALUES (?, 'overlay', ?, X'00')",
            (uuid.uuid4().hex, status),
        )
        conn.commit()


# --- Structure ---------------------------------------------------------------

def test_quest_3_has_render_steps_appended():
    """quest_3 gains export_overlay + wait_for_overlay as its final two steps."""
    q3 = quest_config.QUEST_BY_ID["quest_3"]
    assert q3["step_ids"] == [
        "watch_overlay_tutorial",
        "open_overlay",
        "select_players",
        "choose_color",
        "choose_shape",
        "export_overlay",
        "wait_for_overlay",
    ]
    # Appended at the END, after choose_shape, in order.
    assert q3["step_ids"][-2:] == RENDER_STEPS
    assert q3["reward"] == 25  # unchanged


def test_quest_4_has_no_render_steps():
    """quest_4 keeps only tutorial + the two publish steps."""
    q4 = quest_config.QUEST_BY_ID["quest_4"]
    assert q4["step_ids"] == [
        "watch_publish_tutorial",
        "move_to_my_reels",
        "view_gallery_video",
    ]
    for s in RENDER_STEPS:
        assert s not in q4["step_ids"]
    assert q4["reward"] == 15  # unchanged


def test_render_steps_appear_exactly_once_across_all_quests():
    """The move must not duplicate the render steps into both quests."""
    all_steps = [s for q in quest_config.QUEST_DEFINITIONS for s in q["step_ids"]]
    for s in RENDER_STEPS:
        assert all_steps.count(s) == 1, f"{s} appears {all_steps.count(s)} times"


# --- Triggers (derived from export_jobs, keyed by step id) -------------------

def test_render_triggers_still_fire_from_export_jobs():
    """export_overlay/wait_for_overlay derive from the overlay export aggregate,
    unchanged by the quest they now live in."""
    # No overlay jobs -> both False
    with get_db_connection() as conn:
        steps = _check_all_steps(TEST_USER_ID, conn)
    assert steps["export_overlay"] is False
    assert steps["wait_for_overlay"] is False

    # A started (pending) overlay render -> "Add the Spotlight" done, wait not yet
    _add_overlay_job("pending")
    with get_db_connection() as conn:
        steps = _check_all_steps(TEST_USER_ID, conn)
    assert steps["export_overlay"] is True
    assert steps["wait_for_overlay"] is False

    # A completed overlay render -> both done
    _add_overlay_job("complete")
    with get_db_connection() as conn:
        steps = _check_all_steps(TEST_USER_ID, conn)
    assert steps["export_overlay"] is True
    assert steps["wait_for_overlay"] is True


# --- Migration edge: self-heal covers already-claimed quests -----------------

def test_claimed_quest_3_renders_all_seven_steps():
    """A user who claimed the old 5-step quest_3 keeps it complete: self-heal
    renders all CURRENT step_ids True, so the two new render steps don't un-claim it."""
    from app.services.user_db import mark_quest_completed
    mark_quest_completed(TEST_USER_ID, "quest_3")

    result = asyncio.run(get_progress())
    q3 = next(q for q in result["quests"] if q["id"] == "quest_3")
    assert q3["completed"] is True
    assert q3["reward_claimed"] is True
    assert len(q3["steps"]) == 7
    assert all(q3["steps"].values()), q3["steps"]
    # The moved steps are present and True even though no overlay job exists.
    for s in RENDER_STEPS:
        assert q3["steps"][s] is True


def test_claimed_quest_4_renders_all_three_steps():
    """quest_4 lost two steps; a previously-claimed quest_4 still renders complete
    (removing steps can only make a quest more complete, never less)."""
    from app.services.user_db import mark_quest_completed
    mark_quest_completed(TEST_USER_ID, "quest_4")

    result = asyncio.run(get_progress())
    q4 = next(q for q in result["quests"] if q["id"] == "quest_4")
    assert q4["completed"] is True
    assert q4["reward_claimed"] is True
    assert len(q4["steps"]) == 3
    assert all(q4["steps"].values()), q4["steps"]


def test_claim_already_claimed_quest_3_no_double_grant():
    """Claiming an already-completed quest_3 is idempotent: 0 new credits."""
    from app.services.user_db import mark_quest_completed
    mark_quest_completed(TEST_USER_ID, "quest_3")

    result = asyncio.run(claim_reward("quest_3"))
    assert result["already_claimed"] is True
    assert result["credits_granted"] == 0
