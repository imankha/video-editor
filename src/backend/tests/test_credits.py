"""
Tests for the credit system (T530, updated for T540 quest system).

Tests cover:
- Schema initialization (columns + transactions table)
- New users start with 0 credits (signup credits removed in T540)
- Grant credits
- Deduct credits (success + insufficient)
- Refund on failure
- Transaction ledger recording
"""

import sqlite3
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def isolated_auth_db(tmp_path):
    """Use a fresh temp database for each test."""
    db_path = tmp_path / "auth.sqlite"
    with patch("app.services.auth_db.AUTH_DB_PATH", db_path), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True):
        from app.services.auth_db import init_auth_db, create_user
        init_auth_db()
        # Create a test user (starts with 0 credits — T540 removed signup bonus)
        create_user("test-user-1", email="test@example.com")
        yield db_path


class TestSchema:
    """Verify credit columns and transactions table exist after init."""

    def test_users_table_has_credits_column(self, isolated_auth_db):
        conn = sqlite3.connect(str(isolated_auth_db))
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT credits FROM users WHERE user_id = 'test-user-1'").fetchone()
        conn.close()
        assert row["credits"] == 0  # T540: no signup bonus

    def test_credit_transactions_table_exists(self, isolated_auth_db):
        conn = sqlite3.connect(str(isolated_auth_db))
        row = conn.execute("SELECT count(*) as cnt FROM credit_transactions").fetchone()
        conn.close()
        assert row[0] == 0  # T540: no signup_bonus transaction


class TestNoSignupCredits:
    """T540: Users start with 0 credits, earning them via quests."""

    def test_new_user_starts_at_zero(self, isolated_auth_db):
        from app.services.auth_db import get_credit_balance
        balance = get_credit_balance("test-user-1")
        assert balance["balance"] == 0

    def test_no_signup_transaction(self, isolated_auth_db):
        from app.services.auth_db import get_credit_transactions
        txns = get_credit_transactions("test-user-1")
        assert len(txns) == 0

    def test_guest_user_starts_at_zero(self, isolated_auth_db):
        from app.services.auth_db import create_guest_user, get_credit_balance
        guest_id = create_guest_user()
        balance = get_credit_balance(guest_id)
        assert balance["balance"] == 0


class TestGrantCredits:
    def test_grant_increases_balance(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, get_credit_balance
        new_balance = grant_credits("test-user-1", 50, "admin_grant", "test-ref")
        assert new_balance == 50
        balance = get_credit_balance("test-user-1")
        assert balance["balance"] == 50

    def test_grant_records_transaction(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, get_credit_transactions
        grant_credits("test-user-1", 25, "quest_reward", "quest_1")
        txns = get_credit_transactions("test-user-1")
        quest_txn = [t for t in txns if t["source"] == "quest_reward"][0]
        assert quest_txn["amount"] == 25
        assert quest_txn["reference_id"] == "quest_1"

    def test_multiple_grants_accumulate(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, get_credit_balance
        grant_credits("test-user-1", 10, "admin_grant")
        grant_credits("test-user-1", 20, "quest_reward")
        balance = get_credit_balance("test-user-1")
        assert balance["balance"] == 30  # 0 + 10 + 20


class TestDeductCredits:
    def test_deduct_success(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits
        grant_credits("test-user-1", 20, "quest_reward", "quest_1")
        result = deduct_credits("test-user-1", 10, "framing_usage", "job_1", 10.0)
        assert result["success"] is True
        assert result["balance"] == 10  # 20 - 10

    def test_deduct_insufficient_balance(self, isolated_auth_db):
        from app.services.auth_db import deduct_credits
        result = deduct_credits("test-user-1", 50, "framing_usage", "job_1", 50.0)
        assert result["success"] is False
        assert result["balance"] == 0
        assert result["required"] == 50

    def test_deduct_records_negative_transaction(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits, get_credit_transactions
        grant_credits("test-user-1", 20, "quest_reward", "quest_1")
        deduct_credits("test-user-1", 15, "framing_usage", "job_1", 15.0)
        txns = get_credit_transactions("test-user-1")
        usage_txn = [t for t in txns if t["source"] == "framing_usage"][0]
        assert usage_txn["amount"] == -15
        assert usage_txn["video_seconds"] == 15.0

    def test_deduct_exact_balance(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits
        grant_credits("test-user-1", 20, "quest_reward", "quest_1")
        result = deduct_credits("test-user-1", 20, "framing_usage", "job_1", 20.0)
        assert result["success"] is True
        assert result["balance"] == 0

    def test_deduct_nonexistent_user(self, isolated_auth_db):
        from app.services.auth_db import deduct_credits
        result = deduct_credits("nonexistent-user", 10, "framing_usage")
        assert result["success"] is False
        assert result["balance"] == 0


class TestRefund:
    def test_refund_restores_balance(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits, refund_credits, get_credit_balance
        grant_credits("test-user-1", 20, "quest_reward", "quest_1")
        deduct_credits("test-user-1", 15, "framing_usage", "job_1", 15.0)
        refund_credits("test-user-1", 15, "job_1", 15.0)
        balance = get_credit_balance("test-user-1")
        assert balance["balance"] == 20  # fully restored

    def test_refund_records_transaction(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits, refund_credits, get_credit_transactions
        grant_credits("test-user-1", 20, "quest_reward", "quest_1")
        deduct_credits("test-user-1", 10, "framing_usage", "job_1", 10.0)
        refund_credits("test-user-1", 10, "job_1", 10.0)
        txns = get_credit_transactions("test-user-1")
        refund_txn = [t for t in txns if t["source"] == "framing_refund"][0]
        assert refund_txn["amount"] == 10
        assert refund_txn["reference_id"] == "job_1"


class TestTransactionHistory:
    def test_transactions_all_recorded(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits, get_credit_transactions
        grant_credits("test-user-1", 100, "admin_grant", "ref_1")
        deduct_credits("test-user-1", 30, "framing_usage", "ref_2")
        txns = get_credit_transactions("test-user-1")
        assert len(txns) == 2  # admin_grant + framing_usage
        sources = {t["source"] for t in txns}
        assert sources == {"admin_grant", "framing_usage"}

    def test_transactions_limit(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, get_credit_transactions
        for i in range(10):
            grant_credits("test-user-1", 1, "admin_grant", f"ref_{i}")
        txns = get_credit_transactions("test-user-1", limit=3)
        assert len(txns) == 3
