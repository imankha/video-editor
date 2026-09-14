"""T9850 — first-result guidance must complete on saved playable VALUE, not a
mandatory Preview-plays click.

quest_1's last step `playback_annotations` used to gate SOLELY on the
`played_annotations` achievement, fired only by entering Preview-plays mode inside
Annotate. A user who saved a clip and moved to Focus/Spotlight/Library was pinned
at "4/5" pointing at a control that does not exist on those screens (B05·R4).

The fix OR-satisfies the step with a genuine saved result (`rc["reels"] >= 1`, the
own auto-project-clip signal annotate_brilliant/rate_clip already use). Preview
plays stays a sufficient path. Because completion derives in `_check_all_steps` —
the single choke point /progress and /claim-reward share — a displayed-complete
and a rejected claim can never disagree (the T9410 invariant).

Direct-router repro (TestClient avoided, matching test_rate_clip_step.py /
test_t9410_tutorial_step_gating.py in this environment).
"""

import asyncio
import uuid

import pytest

from app.database import get_db_connection
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app.routers.quests import _check_all_steps, get_progress, claim_reward

TEST_USER_ID = f"test_t9850_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault_t9850"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


@pytest.fixture(autouse=True)
def _ctx():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _clean()
    _clean_user_db()
    yield
    _clean()
    _clean_user_db()


def _clean():
    with get_db_connection() as conn:
        conn.execute("DELETE FROM raw_clips")
        conn.execute("DELETE FROM projects")
        conn.execute("DELETE FROM games")
        conn.execute("DELETE FROM achievements")
        conn.commit()


def _clean_user_db():
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(TEST_USER_ID) as conn:
        conn.execute("DELETE FROM completed_quests")
        conn.commit()


def _seed_saved_clip_without_preview():
    """Complete quest_1 the way a user who saved a highlight draft and never opened
    Preview plays would: an OWN 5-star auto-project clip (shared_by NULL default),
    but NO `played_annotations` achievement."""
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("T9850 Game", "t9850_" + uuid.uuid4().hex[:24]),
        )
        cur.execute(
            "INSERT INTO projects (name, aspect_ratio, is_auto_created) VALUES ('t9850', '9:16', 1)"
        )
        project_id = cur.lastrowid
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, name, start_time, end_time, auto_project_id) "
            "VALUES ('', 5, 't9850 clip', 0.0, 3.0, ?)",
            (project_id,),
        )
        conn.commit()


def test_saved_clip_completes_playback_step_without_preview_click():
    """The core fix: a saved playable result completes `playback_annotations` even
    with NO `played_annotations` achievement recorded."""
    with get_db_connection() as conn:
        before = _check_all_steps(TEST_USER_ID, conn)
    # Nothing saved yet — the step is still incomplete (the achievement is the only
    # other path and it hasn't fired).
    assert before["playback_annotations"] is False

    _seed_saved_clip_without_preview()

    with get_db_connection() as conn:
        after = _check_all_steps(TEST_USER_ID, conn)
    assert after["playback_annotations"] is True, "saved clip must satisfy the step"


def test_preview_achievement_still_a_sufficient_path():
    """OR-satisfy, not replace: entering Preview plays still completes the step on
    its own (no saved clip), so no pre-existing completion regresses."""
    with get_db_connection() as conn:
        conn.execute("INSERT OR IGNORE INTO achievements (key) VALUES ('played_annotations')")
        conn.commit()
    with get_db_connection() as conn:
        steps = _check_all_steps(TEST_USER_ID, conn)
    assert steps["playback_annotations"] is True


def test_saved_clip_makes_quest_1_claimable_without_preview():
    """End-to-end at the router seam (acceptance criterion b): saving a highlight
    draft — the direct-export path, no Preview-plays detour — reaches a claimable
    quest_1. Display and claim agree because both derive from _check_all_steps."""
    _seed_saved_clip_without_preview()

    prog = asyncio.run(get_progress())
    q1 = next(q for q in prog["quests"] if q["id"] == "quest_1")
    assert q1["steps"]["playback_annotations"] is True
    # The whole displayed quest is complete via the saved-value path alone.
    assert all(q1["steps"].values()), q1["steps"]
    assert q1["reward_claimed"] is False

    # Claim must succeed — a rendered-complete quest can no longer be rejected.
    res = asyncio.run(claim_reward("quest_1"))
    assert res["already_claimed"] is False
