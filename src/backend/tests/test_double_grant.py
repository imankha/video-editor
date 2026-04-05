"""
Tests for T880: Quest reward and Stripe double-grant idempotency.

The UNIQUE index on credit_transactions(user_id, source, reference_id)
WHERE reference_id IS NOT NULL prevents double-granting credits for the
same quest or payment. These tests verify:
  1. Quest claim idempotency via UNIQUE index
  2. Different quests are independent
  3. Stripe payment idempotency
  4. None reference_id allows duplicates
  5. Quest claim endpoint returns already_claimed on duplicate
  6. Stripe confirm-intent handles duplicate gracefully
"""

import sqlite3
from unittest.mock import patch, MagicMock

import pytest


@pytest.fixture(autouse=True)
def isolated_user_db(tmp_path):
    """Use fresh temp databases for each test."""
    auth_db_path = tmp_path / "auth.sqlite"
    user_data_base = tmp_path / "user_data"
    user_data_base.mkdir()

    with patch("app.services.auth_db.AUTH_DB_PATH", auth_db_path), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True), \
         patch("app.services.user_db.USER_DATA_BASE", user_data_base), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.services.user_db._update_credit_summary"):
        from app.services.auth_db import init_auth_db, create_user
        init_auth_db()
        create_user("test-user-1", email="test@example.com")
        yield tmp_path


# ---------------------------------------------------------------------------
# 1. Quest claim idempotency via UNIQUE index
# ---------------------------------------------------------------------------

class TestQuestClaimIdempotency:
    def test_first_grant_succeeds(self, isolated_user_db):
        from app.services.user_db import grant_credits, get_credit_balance
        new_balance = grant_credits("test-user-1", 15, "quest_reward", "quest_1")
        assert new_balance == 15
        balance = get_credit_balance("test-user-1")
        assert balance["balance"] == 15

    def test_second_identical_grant_raises_integrity_error(self, isolated_user_db):
        from app.services.user_db import grant_credits
        grant_credits("test-user-1", 15, "quest_reward", "quest_1")
        with pytest.raises(sqlite3.IntegrityError):
            grant_credits("test-user-1", 15, "quest_reward", "quest_1")

    def test_balance_only_increased_once(self, isolated_user_db):
        from app.services.user_db import grant_credits, get_credit_balance
        grant_credits("test-user-1", 15, "quest_reward", "quest_1")
        try:
            grant_credits("test-user-1", 15, "quest_reward", "quest_1")
        except sqlite3.IntegrityError:
            pass
        balance = get_credit_balance("test-user-1")
        assert balance["balance"] == 15  # not 30


# ---------------------------------------------------------------------------
# 2. Different quests are independent
# ---------------------------------------------------------------------------

class TestDifferentQuestsIndependent:
    def test_different_quest_ids_both_succeed(self, isolated_user_db):
        from app.services.user_db import grant_credits, get_credit_balance
        b1 = grant_credits("test-user-1", 15, "quest_reward", "quest_1")
        assert b1 == 15
        b2 = grant_credits("test-user-1", 25, "quest_reward", "quest_2")
        assert b2 == 40
        balance = get_credit_balance("test-user-1")
        assert balance["balance"] == 40


# ---------------------------------------------------------------------------
# 3. Stripe payment idempotency
# ---------------------------------------------------------------------------

class TestStripePaymentIdempotency:
    def test_first_stripe_grant_succeeds(self, isolated_user_db):
        from app.services.user_db import grant_credits
        new_balance = grant_credits("test-user-1", 40, "stripe_purchase", "pi_abc123")
        assert new_balance == 40

    def test_second_stripe_grant_raises_integrity_error(self, isolated_user_db):
        from app.services.user_db import grant_credits
        grant_credits("test-user-1", 40, "stripe_purchase", "pi_abc123")
        with pytest.raises(sqlite3.IntegrityError):
            grant_credits("test-user-1", 40, "stripe_purchase", "pi_abc123")

    def test_has_processed_payment_true_after_grant(self, isolated_user_db):
        from app.services.user_db import grant_credits, has_processed_payment
        grant_credits("test-user-1", 40, "stripe_purchase", "pi_abc123")
        assert has_processed_payment("test-user-1", "pi_abc123") is True

    def test_has_processed_payment_false_before_grant(self, isolated_user_db):
        from app.services.user_db import has_processed_payment
        assert has_processed_payment("test-user-1", "pi_abc123") is False


# ---------------------------------------------------------------------------
# 4. None reference_id allows duplicates
# ---------------------------------------------------------------------------

class TestNoneReferenceIdAllowsDuplicates:
    def test_multiple_grants_with_none_reference(self, isolated_user_db):
        from app.services.user_db import grant_credits, get_credit_balance
        grant_credits("test-user-1", 10, "admin_grant", None)
        grant_credits("test-user-1", 10, "admin_grant", None)
        grant_credits("test-user-1", 10, "admin_grant", None)
        balance = get_credit_balance("test-user-1")
        assert balance["balance"] == 30  # all three applied


# ---------------------------------------------------------------------------
# 5. Quest claim endpoint returns already_claimed on duplicate
# ---------------------------------------------------------------------------

class TestQuestClaimEndpoint:
    def test_claim_reward_returns_already_claimed_on_duplicate(self, isolated_user_db):
        """The claim_reward endpoint catches IntegrityError and returns already_claimed."""
        from app.routers.quests import claim_reward
        from app.quest_config import QUEST_DEFINITIONS
        import asyncio

        quest_id = "quest_1"
        user_id = "test-user-1"

        # Mock get_current_user_id and get_db_connection
        # We need all quest steps to appear complete
        all_step_ids = []
        for qdef in QUEST_DEFINITIONS:
            if qdef["id"] == quest_id:
                all_step_ids = qdef["step_ids"]
                break

        all_steps_complete = {sid: True for sid in all_step_ids}

        with patch("app.routers.quests.get_current_user_id", return_value=user_id), \
             patch("app.routers.quests.get_db_connection") as mock_conn, \
             patch("app.routers.quests._check_all_steps", return_value=all_steps_complete), \
             patch("app.routers.quests.mark_quest_completed"):

            loop = asyncio.new_event_loop()
            try:
                # First claim should succeed
                result1 = loop.run_until_complete(claim_reward(quest_id))
                assert result1["already_claimed"] is False
                assert result1["credits_granted"] == 15

                # Second claim should return already_claimed (not raise 500)
                result2 = loop.run_until_complete(claim_reward(quest_id))
                assert result2["already_claimed"] is True
                assert result2["credits_granted"] == 0
            finally:
                loop.close()


# ---------------------------------------------------------------------------
# 6. Stripe confirm-intent handles duplicate gracefully
# ---------------------------------------------------------------------------

class TestStripeConfirmIntentEndpoint:
    def test_confirm_intent_returns_already_processed_on_duplicate(self, isolated_user_db):
        """confirm_payment_intent catches IntegrityError and returns already_processed."""
        from app.routers.payments import confirm_payment_intent, ConfirmIntentRequest
        import asyncio

        user_id = "test-user-1"
        pi_id = "pi_test_double"

        # Mock Stripe and user context
        mock_intent = MagicMock()
        mock_intent.status = "succeeded"
        mock_intent.metadata = {"user_id": user_id, "credits": "40", "pack": "starter"}

        with patch("app.routers.payments.get_current_user_id", return_value=user_id), \
             patch("app.routers.payments.STRIPE_SECRET_KEY", "sk_test_fake"), \
             patch("app.routers.payments.stripe.PaymentIntent.retrieve", return_value=mock_intent):

            req = ConfirmIntentRequest(payment_intent_id=pi_id)

            # First call grants credits
            result1 = asyncio.get_event_loop().run_until_complete(confirm_payment_intent(req))
            assert result1["status"] == "credits_granted"
            assert result1["credits"] == 40

            # Second call hits has_processed_payment fast-path (returns already_processed)
            result2 = asyncio.get_event_loop().run_until_complete(confirm_payment_intent(req))
            assert result2["status"] == "already_processed"
            assert result2["balance"] == 40
