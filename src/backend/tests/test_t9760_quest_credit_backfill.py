"""T9760: proactive backfill of the quest-chain upfront credit grant.

Production ran the pre-T8120 code for a window after T8120 merged, so real
signups in that window received the 8-credit `new_account_bonus` but never
the `quest_upfront` grant. `backfill_quest_upfront_credits` calls the SAME
`grant_quest_chain_credits` every login already calls (JIT) for every
existing user right away, so idle accounts aren't left under-credited
indefinitely. Must never double-grant, must default to a zero-write dry run,
and must keep scanning past a single user's failure.

Real Postgres via the `pg_conn` fixture (gate open by default).
"""

from unittest.mock import patch

from app.quest_config import QUEST_CHAIN_CREDIT_TOTAL
from app.services.credit_ledger import (
    backfill_quest_upfront_credits,
    credit_key,
    get_balance,
    grant,
    grant_quest_chain_credits,
    has_key,
)

USER_A = "user-a"
USER_B = "user-b"
USER_C = "user-c"


def _users(*user_ids):
    return [{"user_id": uid, "email": f"{uid}@example.com"} for uid in user_ids]


class TestBackfillDryRun:
    def test_dry_run_writes_nothing(self, pg_conn):
        with patch(
            "app.services.auth_db.get_all_users_for_admin",
            return_value=_users(USER_A),
        ):
            result = backfill_quest_upfront_credits(dry_run=True)

        assert result["dry_run"] is True
        assert result["topped_up"] == [{"user_id": USER_A, "would_grant": QUEST_CHAIN_CREDIT_TOTAL}]
        # Zero writes: no balance, no idempotency key.
        assert get_balance(USER_A) == 0
        assert not has_key(USER_A, credit_key("quest_upfront", USER_A))

    def test_dry_run_reports_already_full_users(self, pg_conn):
        grant_quest_chain_credits(USER_A)
        with patch(
            "app.services.auth_db.get_all_users_for_admin",
            return_value=_users(USER_A),
        ):
            result = backfill_quest_upfront_credits(dry_run=True)

        assert result["topped_up"] == []
        assert result["already_full"] == 1


class TestBackfillRealRun:
    def test_tops_up_a_signup_only_user(self, pg_conn):
        # Simulate the T9760 scenario: signed up under the stale pre-T8120
        # build, so only the 8-credit bonus ever landed.
        grant(USER_A, 8, "new_account_bonus", credit_key("new_account_bonus", USER_A), reference_id=USER_A)
        assert get_balance(USER_A) == 8

        with patch(
            "app.services.auth_db.get_all_users_for_admin",
            return_value=_users(USER_A),
        ):
            result = backfill_quest_upfront_credits(dry_run=False)

        assert result["topped_up"] == [
            {"user_id": USER_A, "granted": QUEST_CHAIN_CREDIT_TOTAL, "balance": 8 + QUEST_CHAIN_CREDIT_TOTAL}
        ]
        assert get_balance(USER_A) == 8 + QUEST_CHAIN_CREDIT_TOTAL
        assert has_key(USER_A, credit_key("quest_upfront", USER_A))

    def test_never_double_grants_a_repeat_run(self, pg_conn):
        with patch(
            "app.services.auth_db.get_all_users_for_admin",
            return_value=_users(USER_A),
        ):
            first = backfill_quest_upfront_credits(dry_run=False)
            second = backfill_quest_upfront_credits(dry_run=False)

        assert first["topped_up"][0]["granted"] == QUEST_CHAIN_CREDIT_TOTAL
        assert second["topped_up"] == []
        assert second["already_full"] == 1
        assert get_balance(USER_A) == QUEST_CHAIN_CREDIT_TOTAL, "re-running the backfill must not double-grant"

    def test_mid_quest_user_gets_only_the_remainder(self, pg_conn):
        # Legacy per-quest claim under the old drip model: quest_1 = 15.
        grant(USER_A, 15, "quest_reward", credit_key("quest_reward", "quest_1"), reference_id="quest_1")

        with patch(
            "app.services.auth_db.get_all_users_for_admin",
            return_value=_users(USER_A),
        ):
            result = backfill_quest_upfront_credits(dry_run=False)

        assert result["topped_up"][0]["granted"] == QUEST_CHAIN_CREDIT_TOTAL - 15
        assert get_balance(USER_A) == QUEST_CHAIN_CREDIT_TOTAL

    def test_scans_multiple_users_independently(self, pg_conn):
        grant(USER_A, 8, "new_account_bonus", credit_key("new_account_bonus", USER_A), reference_id=USER_A)
        grant(USER_B, 8, "new_account_bonus", credit_key("new_account_bonus", USER_B), reference_id=USER_B)
        grant_quest_chain_credits(USER_C)  # already fully granted

        with patch(
            "app.services.auth_db.get_all_users_for_admin",
            return_value=_users(USER_A, USER_B, USER_C),
        ):
            result = backfill_quest_upfront_credits(dry_run=False)

        assert result["scanned"] == 3
        assert {row["user_id"] for row in result["topped_up"]} == {USER_A, USER_B}
        assert result["already_full"] == 1
        assert get_balance(USER_A) == 8 + QUEST_CHAIN_CREDIT_TOTAL
        assert get_balance(USER_B) == 8 + QUEST_CHAIN_CREDIT_TOTAL

    def test_one_user_failure_does_not_stop_the_scan(self, pg_conn):
        real_grant = grant_quest_chain_credits

        def _flaky(user_id):
            if user_id == USER_B:
                raise RuntimeError("simulated failure")
            return real_grant(user_id)

        with (
            patch("app.services.auth_db.get_all_users_for_admin", return_value=_users(USER_A, USER_B, USER_C)),
            patch("app.services.credit_ledger.grant_quest_chain_credits", side_effect=_flaky),
        ):
            result = backfill_quest_upfront_credits(dry_run=False)

        assert result["scanned"] == 3
        assert {row["user_id"] for row in result["topped_up"]} == {USER_A, USER_C}
        assert result["failed"] == [{"user_id": USER_B, "error": "simulated failure"}]

    def test_limit_partials_the_scan(self, pg_conn):
        with patch(
            "app.services.auth_db.get_all_users_for_admin",
            return_value=_users(USER_A, USER_B, USER_C),
        ):
            result = backfill_quest_upfront_credits(limit=2, dry_run=False)

        assert result["partial"] is True
        assert len(result["topped_up"]) == 2
