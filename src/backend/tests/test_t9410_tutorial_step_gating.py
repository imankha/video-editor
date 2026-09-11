"""T9410 — a genuinely fresh account shows quest_1 at 5/5 (the visible steps) but
POST /claim-reward 400s on the hidden `watch_annotate_tutorial` step.

This is a recurrence of prod bug 35p ("Quest not complete: step
'watch_annotate_tutorial' is incomplete", see test_delete_reregister_newuser_flow.py)
via a DIFFERENT route:

  T8690 hid the four `watch_*_tutorial` steps from the checklist
  (TUTORIAL_VIDEOS_ENABLED = false), so the panel shows 5/5 and offers Continue,
  but left them in quest_config step_ids while claim_reward still gates all six.
  A genuinely fresh account can NEVER fire `watched_annotate_tutorial` (the CTA
  that would fire it is hidden), so quest_1 never enters the user-scoped
  completed/claimed set and the 34p/35p idempotency shortcut never applies ->
  claim_reward re-derives the steps and 400s.

Discriminator vs 35p: this account is NEVER deleted/reregistered and has an EMPTY
user-scoped completed/claimed set. The disagreement therefore comes purely from the
disabled-tutorial gate, not from a resurrected user record.

Direct-router repro (TestClient avoided, matching test_overlay_quest_move.py).
"""

import asyncio
import uuid

import pytest
from fastapi import HTTPException

from app import quest_config
from app.database import get_db_connection
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id
from app.routers.quests import get_progress, claim_reward

TEST_USER_ID = f"test_t9410_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault_t9410"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

# quest_1's user-completable steps once the tutorial videos are disabled — the
# five the panel actually renders and counts toward "5/5".
VISIBLE_QUEST1_STEPS = [
    "upload_game",
    "add_clip",
    "rate_clip",
    "annotate_brilliant",
    "playback_annotations",
]


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
    """A successful claim writes quest_1 into the user-scoped completed set; every
    test here shares one TEST_USER_ID, so clear it or the next claim short-circuits
    on the idempotent already-claimed branch instead of re-deriving the gate."""
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(TEST_USER_ID) as conn:
        conn.execute("DELETE FROM completed_quests")
        conn.commit()


def _seed_visible_quest1_steps():
    """Complete the five user-facing quest_1 steps, leaving watch_annotate_tutorial
    the ONLY unsatisfied step in quest_config's step_ids (its CTA is hidden, so a
    real user can never fire it)."""
    with get_db_connection() as conn:
        cur = conn.cursor()
        # upload_game — an OWN game (shared_by NULL).
        cur.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("T9410 Game", "t9410_" + uuid.uuid4().hex[:24]),
        )
        # A project so the 5-star auto-reel's auto_project_id FK resolves.
        cur.execute(
            "INSERT INTO projects (name, aspect_ratio, is_auto_created) VALUES ('t9410', '9:16', 1)"
        )
        project_id = cur.lastrowid
        # add_clip (total >= 1) + rate_clip (reels >= 1) + annotate_brilliant
        # (reels >= 1): one OWN 5-star auto-reel raw_clip (shared_by NULL default).
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, name, start_time, end_time, auto_project_id) "
            "VALUES ('', 5, 't9410 clip', 0.0, 3.0, ?)",
            (project_id,),
        )
        # playback_annotations — the recorded achievement.
        cur.execute("INSERT OR IGNORE INTO achievements (key) VALUES ('played_annotations')")
        conn.commit()


def test_fresh_account_visible_5of5_can_claim_quest_1():
    """RED before the fix: the panel shows 5/5 (all visible steps done) and offers
    Continue, but claim_reward 400s on the hidden `watch_annotate_tutorial` step.

    GREEN after the fix: a displayed-complete quest_1 is claimable — a rendered 5/5
    and a rejected claim can no longer coexist.
    """
    _seed_visible_quest1_steps()

    prog = asyncio.run(get_progress())
    q1 = next(q for q in prog["quests"] if q["id"] == "quest_1")

    # The five user-facing steps are all complete — this is the "5/5" the panel renders.
    for sid in VISIBLE_QUEST1_STEPS:
        assert q1["steps"][sid] is True, f"expected visible step {sid} complete"

    # Never claimed/reregistered: the completed/claimed shortcut cannot apply here.
    assert q1["reward_claimed"] is False

    # The claim must succeed. Pre-fix this raises
    # HTTP 400 "Quest not complete: step 'watch_annotate_tutorial' is incomplete".
    res = asyncio.run(claim_reward("quest_1"))
    assert res["already_claimed"] is False
    assert res["credits_granted"] == 0


def test_incomplete_visible_step_still_blocks_and_names_that_step():
    """Guard against loosening: a genuinely incomplete quest_1 (no content at all)
    still 400s, and the diagnostic names a REAL user-facing step (upload_game) — not
    the hidden tutorial step, which is vacuously satisfied while videos are off."""
    with pytest.raises(HTTPException) as ei:
        asyncio.run(claim_reward("quest_1"))
    assert ei.value.status_code == 400
    detail = ei.value.detail
    step_id = detail["step_id"] if isinstance(detail, dict) else detail
    assert step_id == "upload_game"
    assert "watch_annotate_tutorial" != step_id


def test_tutorial_step_still_gated_when_videos_enabled(monkeypatch):
    """The auto-satisfy is scoped to the disabled feature: with videos ENABLED, the
    fresh account (no `watched_annotate_tutorial` achievement) is blocked on the
    tutorial step exactly as before — the fix does not permanently drop the gate."""
    monkeypatch.setattr(quest_config, "TUTORIAL_VIDEOS_ENABLED", True)
    _seed_visible_quest1_steps()

    with pytest.raises(HTTPException) as ei:
        asyncio.run(claim_reward("quest_1"))
    assert ei.value.status_code == 400
    detail = ei.value.detail
    step_id = detail["step_id"] if isinstance(detail, dict) else detail
    assert step_id == "watch_annotate_tutorial"
