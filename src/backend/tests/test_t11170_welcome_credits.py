"""T11170: welcome credits no longer depend on the quest system.

The 80-credit "welcome" grant (part of the advertised 88 free credits) used to
be granted by credit_ledger.grant_quest_chain_credits, which read the amount from
quest_config.QUEST_CHAIN_CREDIT_TOTAL. This task MOVES that grant to
storage_credits.grant_welcome_credits (amount storage_credits.WELCOME_CREDITS) so
deleting the quest system later never touches the credit grant.

Two things must hold and are proven here through STABLE production seams (so the
same test is red on the pre-change revision and green after):

  * Decoupling — a fresh signup still ends at the advertised 88 total EVEN WITH
    quest_config's credit constant removed (`test_fresh_signup_*`). Pre-change,
    the grant flowed through grant_quest_chain_credits' `from ..quest_config
    import QUEST_CHAIN_CREDIT_TOTAL`, so removing the constant broke the grant.
  * Deletion — the T9760 admin backfill endpoint is gone (`test_admin_backfill_*`).

The ledger SOURCE/KEY strings (`quest_upfront`, `questbank:`) and the summed
"already granted" source set (`quest_reward`, `quest_upfront`) are FROZEN: renaming
any of them makes every existing account look like it has 0 granted and pays the 80
again. `test_frozen_ledger_strings` fails loudly if that ever changes.

Real Postgres via the `pg_conn` / `hermetic` fixtures (gate open by default).
"""

import inspect
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

WELCOME_TOTAL = 80          # storage_credits.WELCOME_CREDITS (frozen amount, G1)
SIGNUP_BONUS = 8            # storage_credits.NEW_ACCOUNT_CREDITS
ADVERTISED_TOTAL = 88       # landing/src/site.ts freeCredits


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# hermetic session_init fixture — mirrors test_delete_reregister_newuser_flow.py:
# per-user SQLite under tmp, R2 disabled, caches redirected. Lets us drive the
# REAL user_session_init signup path (the acceptance seam) without real R2.
# ---------------------------------------------------------------------------

@pytest.fixture
def hermetic(tmp_path, monkeypatch, pg_conn):
    base = tmp_path / "user_data"
    base.mkdir()
    monkeypatch.setattr("app.database.USER_DATA_BASE", base)
    monkeypatch.setattr("app.services.user_db.USER_DATA_BASE", base)
    monkeypatch.setattr("app.routers.auth.USER_DATA_BASE", base)
    monkeypatch.setattr("app.database.R2_ENABLED", False)
    monkeypatch.setattr("app.storage.R2_ENABLED", False)
    monkeypatch.setattr("app.routers.auth.R2_ENABLED", False)
    monkeypatch.setattr("app.services.user_db._initialized_user_dbs", set())
    monkeypatch.setattr("app.database._initialized_users", set())
    monkeypatch.setattr("app.database._user_sqlite_versions", {})
    monkeypatch.setattr("app.database._user_db_versions", {})
    yield base


# ---------------------------------------------------------------------------
# Decoupling — the acceptance criterion, through the real session_init seam.
# ---------------------------------------------------------------------------

class TestFreshSignupDecoupledFromQuests:
    def test_fresh_signup_reaches_advertised_total_without_quest_config(self, hermetic, monkeypatch):
        """A genuinely new signup ends at 88 total (8 bonus + 80 welcome) EVEN
        when quest_config's credit constant is gone.

        Pre-change: session_init -> grant_quest_chain_credits ->
        `from ..quest_config import QUEST_CHAIN_CREDIT_TOTAL` raises ImportError
        with the attribute removed, so the welcome grant never lands (RED).
        Post-change: the grant lives in storage_credits and never touches
        quest_config, so the full 88 still lands (GREEN).
        """
        import app.quest_config as qc
        # Remove the quest-system credit constant the OLD grant path depended on.
        monkeypatch.delattr(qc, "QUEST_CHAIN_CREDIT_TOTAL", raising=False)

        from app.services.credit_ledger import get_credit_balance
        from app.session_init import _init_cache, user_session_init
        from app.user_context import set_current_user_id

        uid = _uid("t11170")
        set_current_user_id(uid)  # what the auth middleware does before init
        _init_cache.pop(uid, None)
        result = user_session_init(uid)

        assert result["is_new_user"] is True
        assert get_credit_balance(uid)["balance"] == ADVERTISED_TOTAL

    def test_second_session_init_grants_no_more(self, hermetic):
        """Idempotency at the seam: re-initialising the same user grants 0 more."""
        from app.services.credit_ledger import get_credit_balance
        from app.session_init import _init_cache, user_session_init
        from app.user_context import set_current_user_id

        uid = _uid("t11170idem")
        set_current_user_id(uid)  # what the auth middleware does before init
        _init_cache.pop(uid, None)
        user_session_init(uid)
        assert get_credit_balance(uid)["balance"] == ADVERTISED_TOTAL

        # Force the slow path again (as a real re-login would) -- still no double-grant.
        _init_cache.pop(uid, None)
        user_session_init(uid)
        assert get_credit_balance(uid)["balance"] == ADVERTISED_TOTAL


# ---------------------------------------------------------------------------
# The moved grant function itself (new symbols; function-local imports keep this
# file importable on the pre-change revision for the proof-verifier).
# ---------------------------------------------------------------------------

class TestGrantWelcomeCredits:
    def test_new_user_gets_full_welcome_total(self, pg_conn):
        from app.services.credit_ledger import credit_key, get_balance, has_key
        from app.services.storage_credits import WELCOME_CREDITS, grant_welcome_credits

        uid = "user-a"
        result = grant_welcome_credits(uid)
        assert result["applied"] is True
        assert result["granted"] == WELCOME_CREDITS == WELCOME_TOTAL
        assert get_balance(uid) == WELCOME_CREDITS
        assert has_key(uid, credit_key("quest_upfront", uid))

    def test_repeat_call_is_a_noop(self, pg_conn):
        from app.services.credit_ledger import get_balance
        from app.services.storage_credits import WELCOME_CREDITS, grant_welcome_credits

        uid = "user-a"
        grant_welcome_credits(uid)
        second = grant_welcome_credits(uid)
        assert second["applied"] is False
        assert second["granted"] == 0
        assert get_balance(uid) == WELCOME_CREDITS

    def test_legacy_quest_reward_rows_only_pay_the_remainder(self, pg_conn):
        """An account that already received legacy per-quest rewards (source
        `quest_reward`) summing to 30 gets only the remaining 50 -- the exact
        remainder logic moved from grant_quest_chain_credits."""
        from app.services.credit_ledger import credit_key, get_balance, grant
        from app.services.storage_credits import WELCOME_CREDITS, grant_welcome_credits

        uid = "user-a"
        grant(uid, 30, "quest_reward", credit_key("quest_reward", "legacy"), reference_id="legacy")
        assert get_balance(uid) == 30

        result = grant_welcome_credits(uid)
        assert result["applied"] is True
        assert result["granted"] == WELCOME_CREDITS - 30
        assert get_balance(uid) == WELCOME_CREDITS


# ---------------------------------------------------------------------------
# Frozen-string invariant guard — fails loudly if anyone renames the ledger
# source/key strings. Its job is to break the build on a rename, not to prove
# anything about this task's diff. Stable symbols only (portable across revisions).
# ---------------------------------------------------------------------------

class TestFrozenLedgerStrings:
    def test_key_prefix_and_source_are_byte_identical(self):
        from app.services.credit_ledger import KEY_PREFIX, credit_key

        assert KEY_PREFIX["quest_upfront"] == "questbank"
        assert credit_key("quest_upfront", "abc") == "questbank:abc"

    def test_already_granted_source_set_unchanged(self):
        """The 'already granted' remainder query must still sum exactly the
        historic sources `quest_reward` and `quest_upfront`. Guarding the literal
        SQL text catches a silent rename that would zero every account's tally."""
        from app.services.credit_ledger import _granted_quest_chain_credits

        src = inspect.getsource(_granted_quest_chain_credits)
        assert "'quest_reward', 'quest_upfront'" in src


# ---------------------------------------------------------------------------
# Deletion — the T9760 admin backfill endpoint is gone (G2). Stable seam (the
# FastAPI app + URL); portable across revisions.
# ---------------------------------------------------------------------------

class TestAdminBackfillEndpointRemoved:
    def test_backfill_quest_upfront_endpoint_returns_404(self, pg_conn, tmp_path):
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db._initialized_user_dbs", set()):
            from app.main import app
            client = TestClient(app, raise_server_exceptions=True)

        resp = client.post(
            "/api/admin/backfill-quest-upfront-credits",
            headers={"X-User-ID": "admin-user"},
        )
        assert resp.status_code == 404
