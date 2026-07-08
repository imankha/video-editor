"""T4780 — tutorial-watch steps are the first step of each quest.

Tests run against the CURRENT code (failing until Stage 4 implements the changes).
They verify:
1. Each quest in QUEST_DEFINITIONS has its tutorial step_id first.
2. _check_all_steps derives tutorial steps purely from their achievement keys.
3. POST /api/quests/achievements/<key> accepts all 4 tutorial achievement keys (via router logic).
4. GET /api/quests/definitions lists the tutorial step as first in each quest (via router logic).
5. Claim is blocked if the tutorial step is not yet done (via router logic).

Note: TestClient is not used here due to an httpx/starlette version mismatch in this
environment. Tests call the internal quest logic directly.
"""

import asyncio
import uuid

import pytest

from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app import quest_config
from app.routers.quests import _check_all_steps, KNOWN_ACHIEVEMENT_KEYS, get_definitions, record_achievement

TEST_USER_ID = f"test_tutorial_steps_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault_tutorial"

# Pre-populate init cache so middleware takes the fast path (no DB opens)
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

# Expected tutorial step/achievement pairs
TUTORIAL_STEPS = [
    ("quest_1", "watch_annotate_tutorial", "watched_annotate_tutorial"),
    ("quest_2", "watch_framing_tutorial", "watched_framing_tutorial"),
    ("quest_3", "watch_overlay_tutorial", "watched_overlay_tutorial"),
    ("quest_4", "watch_publish_tutorial", "watched_publish_tutorial"),
]


@pytest.fixture(autouse=True)
def _ctx():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    yield


def test_tutorial_step_is_first_in_each_quest():
    """QUEST_DEFINITIONS has tutorial step_id as the first step of each quest."""
    quest_by_id = {q["id"]: q for q in quest_config.QUEST_DEFINITIONS}
    for quest_id, step_id, _ in TUTORIAL_STEPS:
        quest = quest_by_id[quest_id]
        assert quest["step_ids"][0] == step_id, (
            f"{quest_id}: expected first step to be '{step_id}', "
            f"got '{quest['step_ids'][0]}'"
        )


def test_definitions_endpoint_tutorial_step_first():
    """GET /api/quests/definitions returns tutorial step as first in each quest."""
    # Call the async handler directly
    definitions = asyncio.get_event_loop().run_until_complete(get_definitions())
    by_id = {q["id"]: q for q in definitions}
    for quest_id, step_id, _ in TUTORIAL_STEPS:
        quest = by_id[quest_id]
        assert quest["step_ids"][0] == step_id, (
            f"{quest_id}: expected first step_id '{step_id}', "
            f"got '{quest['step_ids'][0]}'"
        )


def test_tutorial_achievement_accepted():
    """Achievement keys for tutorial steps are in KNOWN_ACHIEVEMENT_KEYS."""
    for _, _, achievement_key in TUTORIAL_STEPS:
        assert achievement_key in KNOWN_ACHIEVEMENT_KEYS, (
            f"Expected '{achievement_key}' to be in KNOWN_ACHIEVEMENT_KEYS"
        )


def test_tutorial_step_derives_from_achievement():
    """_check_all_steps returns True for tutorial step when achievement is recorded."""
    from app.database import get_db_connection
    for quest_id, step_id, achievement_key in TUTORIAL_STEPS:
        with get_db_connection() as conn:
            # Ensure clean state
            conn.execute("DELETE FROM achievements WHERE key = ?", (achievement_key,))
            conn.commit()

            # Confirm step is False without achievement
            steps_before = _check_all_steps(TEST_USER_ID, conn)
            assert steps_before.get(step_id) is False, (
                f"{step_id}: expected False before achievement recorded, "
                f"got {steps_before.get(step_id)}"
            )

            # Record the achievement
            conn.execute(
                "INSERT OR IGNORE INTO achievements (key) VALUES (?)",
                (achievement_key,),
            )
            conn.commit()

            # Confirm step is now True
            steps_after = _check_all_steps(TEST_USER_ID, conn)
            assert steps_after.get(step_id) is True, (
                f"{step_id}: expected True after achievement recorded, "
                f"got {steps_after.get(step_id)}"
            )

            # Cleanup
            conn.execute("DELETE FROM achievements WHERE key = ?", (achievement_key,))
            conn.commit()


def test_claim_blocked_without_tutorial_step():
    """Quest claim fails when tutorial step is incomplete (step not in computed steps)."""
    from app.database import get_db_connection
    from fastapi import HTTPException

    # Ensure the tutorial achievement is NOT recorded
    with get_db_connection() as conn:
        conn.execute("DELETE FROM achievements WHERE key = 'watched_annotate_tutorial'")
        conn.commit()

    # Find the quest definition for quest_1
    qdef = next((q for q in quest_config.QUEST_DEFINITIONS if q["id"] == "quest_1"), None)
    assert qdef is not None

    # Compute steps — tutorial step should be False
    with get_db_connection() as conn:
        all_steps = _check_all_steps(TEST_USER_ID, conn)

    # Simulate the claim-reward step check
    incomplete_steps = [sid for sid in qdef["step_ids"] if not all_steps.get(sid, False)]
    assert "watch_annotate_tutorial" in incomplete_steps, (
        f"Expected 'watch_annotate_tutorial' to be incomplete, "
        f"but all_steps has: {all_steps.get('watch_annotate_tutorial')}"
    )
