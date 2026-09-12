"""T9690 — Failure-path regression coverage for quest completion (claim-reward).

This is the durable net for the B7/B9 class of bug fixed by T9410 + the 34p/35p
idempotency fix: *an operation half-succeeded and the UI reported the optimistic
half.* The happy path passes with or without those fixes; only an explicit
FAILURE-INJECTION test keeps them from silently regressing.

Every test here injects a REAL failure condition (a raised mid-write, a wiped
active profile on resume, a duplicated request) and asserts the endpoint's actual
recovery behavior. None of them stubs the endpoint under test into succeeding.

Guards (each maps to a revertable fix; see the module's red-green proof):
  * T9410 tutorials-off vacuous-satisfy (quests.py `tutorials_off or ...`):
    a displayed-5/5 fresh account is CLAIMABLE — a rendered 5/5 and a rejected
    completion can never coexist.
  * 34p/35p idempotency shortcut (quests.py claim_reward completed/claimed branch):
    a resumed or duplicated claim files the completion exactly once and never
    replays already-saved work.

Direct-router repro (TestClient avoided, matching test_t9410_tutorial_step_gating.py).
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
from app.routers import quests as quests_mod
from app.routers.quests import claim_reward, get_progress

TEST_USER_ID = f"test_t9690_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault_t9690"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


@pytest.fixture(autouse=True)
def _ctx():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _clean_profile()
    _clean_user_db()
    yield
    _clean_profile()
    _clean_user_db()


def _clean_profile():
    with get_db_connection() as conn:
        conn.execute("DELETE FROM raw_clips")
        conn.execute("DELETE FROM projects")
        conn.execute("DELETE FROM games")
        conn.execute("DELETE FROM achievements")
        conn.commit()


def _clean_user_db():
    """Each test shares one TEST_USER_ID; a successful claim writes quest_1 into the
    user-scoped completed set, so clear it or the next claim short-circuits on the
    already-claimed branch instead of exercising the gate under test."""
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(TEST_USER_ID) as conn:
        conn.execute("DELETE FROM completed_quests")
        conn.commit()


def _seed_visible_quest1_steps():
    """Complete the five user-facing quest_1 steps, leaving watch_annotate_tutorial
    the only unsatisfied step in quest_config's step_ids (its CTA is hidden while
    tutorial videos are disabled, so a real user can never fire it)."""
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("T9690 Game", "t9690_" + uuid.uuid4().hex[:24]),
        )
        cur.execute(
            "INSERT INTO projects (name, aspect_ratio, is_auto_created) VALUES ('t9690', '9:16', 1)"
        )
        project_id = cur.lastrowid
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, name, start_time, end_time, auto_project_id) "
            "VALUES ('', 5, 't9690 clip', 0.0, 3.0, ?)",
            (project_id,),
        )
        cur.execute("INSERT OR IGNORE INTO achievements (key) VALUES ('played_annotations')")
        conn.commit()


def _completed_ids():
    from app.services.user_db import get_completed_and_claimed_quest_ids
    completed, _claimed = get_completed_and_claimed_quest_ids(TEST_USER_ID)
    return completed


# ---------------------------------------------------------------------------
# Scope 1 — Interrupted completion saves: the quest step persists, or it does
# not; never both. A 5/5-displayed quest and a rejected completion cannot coexist.
# ---------------------------------------------------------------------------

def test_interrupted_completion_save_is_atomic_then_resumes_exactly_once(monkeypatch):
    """INJECTED FAILURE: the user-scoped completion write (mark_quest_completed)
    raises mid-flight on the first claim (a killed DB write / lost connection).

    Atomicity: after the failed attempt the completion must NOT be recorded — the
    endpoint may not report success on a write it did not durably make. The panel's
    5/5 and an unrecorded completion cannot coexist as a half-state.

    Resume: with the failure cleared, the retry completes and files the completion
    EXACTLY ONCE (no double-count from the interrupted first attempt).

    Reverting T9410 (quests.py `tutorials_off or ...`) turns this red: the 5/5
    account 400s on the hidden watch_annotate_tutorial step before the write is
    even reached, so the resume claim raises instead of succeeding.
    """
    _seed_visible_quest1_steps()

    milestones = []
    monkeypatch.setattr(
        "app.analytics.record_milestone",
        lambda uid, event, meta: milestones.append(event),
    )

    # --- First attempt: the completion write is interrupted. ---
    real_mark = quests_mod.mark_quest_completed
    calls = {"n": 0}

    def _flaky_mark(uid, quest_id):
        calls["n"] += 1
        raise ConnectionError("simulated interrupted write to user.sqlite")

    monkeypatch.setattr(quests_mod, "mark_quest_completed", _flaky_mark)

    with pytest.raises(ConnectionError):
        asyncio.run(claim_reward("quest_1"))

    # The write failed -> the completion is NOT recorded, and no success milestone
    # fired. Never "both": no persisted completion behind a returned success.
    assert _completed_ids() == set(), "an interrupted write must leave NO completion recorded"
    assert milestones == [], "no quest_completed milestone may fire when the write failed"
    assert calls["n"] == 1

    # --- Retry: failure cleared, the claim now completes. ---
    monkeypatch.setattr(quests_mod, "mark_quest_completed", real_mark)
    res = asyncio.run(claim_reward("quest_1"))
    assert res["already_claimed"] is False
    assert _completed_ids() == {"quest_1"}, "the resumed claim must file the completion"
    assert milestones == ["quest_completed"], "the completion must be recorded exactly once"


# ---------------------------------------------------------------------------
# Scope 2 — Refresh and resume mid-flow: no replay of already-saved work.
# ---------------------------------------------------------------------------

def test_resume_after_completion_does_not_replay_on_a_switched_profile(monkeypatch):
    """A user completes quest_1, then refreshes / resumes onto a profile whose
    active step data no longer derives complete (a profile switch or resurrected
    account — the real 34p/35p shape). /progress still reports it complete from the
    user-scoped record; the resumed claim must honor that and return already_claimed,
    replaying nothing.

    INJECTED CONDITION: the active profile's step-supporting content is wiped
    between the first claim and the resume, so re-deriving the steps would fail.

    Reverting the idempotency shortcut (quests.py claim_reward completed/claimed
    branch) turns this red: the resumed claim re-derives steps against the wiped
    profile and 400s on upload_game.
    """
    milestones = []
    monkeypatch.setattr(
        "app.analytics.record_milestone",
        lambda uid, event, meta: milestones.append(event),
    )

    _seed_visible_quest1_steps()
    first = asyncio.run(claim_reward("quest_1"))
    assert first["already_claimed"] is False
    assert _completed_ids() == {"quest_1"}

    # Resume onto a profile that no longer has the step data (switch / resurrection).
    _clean_profile()
    prog = asyncio.run(get_progress())
    q1 = next(q for q in prog["quests"] if q["id"] == "quest_1")
    assert q1["completed"] is True, "/progress must still report quest_1 complete (user-scoped)"

    # The resumed claim must NOT 400 and must NOT replay the completion milestone.
    res = asyncio.run(claim_reward("quest_1"))
    assert res["already_claimed"] is True
    assert res["credits_granted"] == 0
    assert milestones == ["quest_completed"], "resume must not replay the completion milestone"
    assert _completed_ids() == {"quest_1"}


# ---------------------------------------------------------------------------
# Scope 4 — Duplicate requests on the completion path.
# ---------------------------------------------------------------------------

def test_duplicate_claim_requests_file_completion_exactly_once(monkeypatch):
    """A double-clicked / retried claim fires claim_reward several times against a
    genuinely complete quest. Exactly one call may be the earning claim
    (already_claimed False); the rest must be idempotent no-ops, and the
    quest_completed milestone must fire exactly once.

    Reverting the idempotency shortcut (quests.py claim_reward completed/claimed
    branch) turns this red: every duplicate re-derives the (still-complete) steps,
    re-marks the quest, and re-fires the milestone, so the completion is recorded
    N times instead of once.
    """
    milestones = []
    monkeypatch.setattr(
        "app.analytics.record_milestone",
        lambda uid, event, meta: milestones.append(event),
    )

    _seed_visible_quest1_steps()

    results = [asyncio.run(claim_reward("quest_1")) for _ in range(3)]

    earning = [r for r in results if r["already_claimed"] is False]
    deduped = [r for r in results if r["already_claimed"] is True]
    assert len(earning) == 1, "exactly one duplicate may be the earning claim"
    assert len(deduped) == 2, "the remaining duplicates must be idempotent no-ops"
    assert milestones == ["quest_completed"], "duplicates must not re-record the completion"
    assert _completed_ids() == {"quest_1"}


def test_incomplete_quest_still_blocks_under_duplicate_requests(monkeypatch):
    """Guard against loosening: duplicated claims on a genuinely INCOMPLETE quest
    must all 400 and name a real user-facing step — the idempotency shortcut only
    applies to a quest already in the completed/claimed set, never as a loosened
    gate. (tutorials-off makes watch_annotate_tutorial vacuous, so the blocking
    step is the first real one, upload_game.)"""
    for _ in range(3):
        with pytest.raises(HTTPException) as ei:
            asyncio.run(claim_reward("quest_1"))
        assert ei.value.status_code == 400
        detail = ei.value.detail
        step_id = detail["step_id"] if isinstance(detail, dict) else detail
        assert step_id == "upload_game"
    assert _completed_ids() == set()
