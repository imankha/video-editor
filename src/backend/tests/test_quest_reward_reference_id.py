"""M4 regression (T5840 review round 2): quest grants must carry reference_id.

`quests.py:claim_reward` used to call `credit_ledger.grant(...)` with only 4
positional args, so `reference_id` defaulted to None. `get_completed_and_claimed_quest_ids`
builds its claimed set from `credit_transactions.reference_id`, and
`backfill_completed_quests` (T970 recovery after a user.sqlite reset) filters
`reference_id IS NOT NULL` -- with reference_id always None, the claimed set
was permanently empty and quest recovery was a dead no-op, in exactly the
"user.sqlite got reset" scenario this whole epic exists for.

Drives the REAL router `claim_reward` end-to-end (step-completion mocked so
the test doesn't need to build real annotate/export state) against real
Postgres via pg_conn.
"""

import asyncio
import uuid

import pytest

from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id

USER_ID = f"quest_ref_{uuid.uuid4().hex[:8]}"
PROFILE_ID = "testdefault_questref"


@pytest.fixture(autouse=True)
def _ctx(pg_conn):
    _init_cache[USER_ID] = {"profile_id": PROFILE_ID, "is_new_user": False}
    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)
    yield


@pytest.fixture(autouse=True)
def _all_steps_complete(monkeypatch):
    """Skip real step-derivation -- this test is about the grant's
    reference_id, not quest step logic."""
    import app.routers.quests as quests_mod
    monkeypatch.setattr(quests_mod, "_check_all_steps", lambda user_id, conn: dict.fromkeys(
        [sid for qdef in quests_mod.QUEST_DEFINITIONS for sid in qdef["step_ids"]], True
    ))


def test_claim_reward_grant_carries_reference_id(pg_conn):
    from app.routers.quests import claim_reward
    from app.services.credit_ledger import credit_key, has_key, list_transactions

    quest_id = "quest_1"
    result = asyncio.run(claim_reward(quest_id))

    assert result["already_claimed"] is False
    assert result["credits_granted"] > 0
    assert has_key(USER_ID, credit_key("quest_reward", quest_id))

    txns = list_transactions(USER_ID)
    quest_txn = next(t for t in txns if t["source"] == "quest_reward")
    assert quest_txn["reference_id"] == quest_id, (
        "M4: reference_id must be the quest_id, not None -- otherwise "
        "get_completed_and_claimed_quest_ids/backfill_completed_quests can "
        "never recover this grant"
    )


def test_quest_recovery_after_user_sqlite_reset(pg_conn):
    """The exact scenario M4 protects: user.sqlite's completed_quests table is
    wiped (simulating a reset/resurrected account) -- backfill_completed_quests
    must be able to rebuild it from the Postgres ledger's reference_id."""
    from app.routers.quests import claim_reward
    from app.services.user_db import (
        backfill_completed_quests,
        get_completed_and_claimed_quest_ids,
        get_user_db_connection,
    )

    quest_id = "quest_1"
    asyncio.run(claim_reward(quest_id))

    # Simulate a user.sqlite reset: the completed_quests table is empty again,
    # but the Postgres ledger (the source of truth) still has the grant.
    with get_user_db_connection(USER_ID) as conn:
        conn.execute("DELETE FROM completed_quests")
        conn.commit()

    completed_before, claimed = get_completed_and_claimed_quest_ids(USER_ID)
    assert completed_before == set(), "sanity: completed_quests really is empty"
    assert quest_id in claimed, "the PG-derived claimed set survives the reset"

    recovered = backfill_completed_quests(USER_ID)
    assert recovered == 1, "M4: recovery must find the quest_reward row via reference_id"

    completed_after, _ = get_completed_and_claimed_quest_ids(USER_ID)
    assert quest_id in completed_after
