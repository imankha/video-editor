"""T8120: upfront quest-chain credit grant + idempotency.

Per-quest credit rewards are retired; the whole chain total
(QUEST_CHAIN_CREDIT_TOTAL) is granted upfront through
credit_ledger.grant_quest_chain_credits — at signup for new users, as the
ungranted remainder on next login for existing mid-quest users. This must NEVER
double-grant: a repeat call is a no-op, and a user who already claimed some
legacy per-quest rewards gets only the remainder.

Real Postgres via the `pg_conn` fixture (gate open by default).
"""

from app.quest_config import QUEST_CHAIN_CREDIT_TOTAL
from app.services import credit_ledger
from app.services.credit_ledger import (
    credit_key,
    get_balance,
    grant,
    grant_quest_chain_credits,
    has_key,
)

USER = "user-a"


class TestUpfrontGrant:
    def test_new_user_gets_full_chain_total(self, pg_conn):
        result = grant_quest_chain_credits(USER)
        assert result["applied"] is True
        assert result["granted"] == QUEST_CHAIN_CREDIT_TOTAL
        assert get_balance(USER) == QUEST_CHAIN_CREDIT_TOTAL
        # The fixed per-user idempotency key is recorded.
        assert has_key(USER, credit_key("quest_upfront", USER))

    def test_second_call_is_a_noop_no_double_grant(self, pg_conn):
        first = grant_quest_chain_credits(USER)
        second = grant_quest_chain_credits(USER)

        assert first["granted"] == QUEST_CHAIN_CREDIT_TOTAL
        assert second["applied"] is False
        assert second["granted"] == 0
        assert get_balance(USER) == QUEST_CHAIN_CREDIT_TOTAL, "repeat login must not double-grant"

    def test_mid_quest_user_gets_only_the_remainder(self, pg_conn):
        # Simulate an existing account that already claimed quest_1 under the
        # legacy per-quest path (source='quest_reward'): 15 credits.
        grant(USER, 15, "quest_reward", credit_key("quest_reward", "quest_1"), reference_id="quest_1")
        assert get_balance(USER) == 15

        result = grant_quest_chain_credits(USER)
        assert result["applied"] is True
        # Remainder = total - already-claimed, never the full total again.
        assert result["granted"] == QUEST_CHAIN_CREDIT_TOTAL - 15
        assert get_balance(USER) == QUEST_CHAIN_CREDIT_TOTAL

        # And it's still idempotent from there.
        again = grant_quest_chain_credits(USER)
        assert again["granted"] == 0
        assert get_balance(USER) == QUEST_CHAIN_CREDIT_TOTAL

    def test_fully_claimed_legacy_user_gets_nothing(self, pg_conn):
        # A user who already claimed every quest under the legacy path (sum ==
        # the chain total) gets a pure no-op and no upfront key is written.
        grant(USER, QUEST_CHAIN_CREDIT_TOTAL, "quest_reward",
              credit_key("quest_reward", "quest_all"), reference_id="quest_all")

        result = grant_quest_chain_credits(USER)
        assert result["applied"] is False
        assert result["granted"] == 0
        assert get_balance(USER) == QUEST_CHAIN_CREDIT_TOTAL
        assert not has_key(USER, credit_key("quest_upfront", USER))

    def test_coexists_with_signup_bonus(self, pg_conn):
        # The upfront grant lives in a distinct key space from the new-account
        # bonus (signup:) so both land for a brand-new user.
        credit_ledger.grant_credits(USER, 8, source="new_account_bonus")
        grant_quest_chain_credits(USER)
        assert get_balance(USER) == 8 + QUEST_CHAIN_CREDIT_TOTAL
