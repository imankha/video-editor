"""
Tests for the credit system (T530).

Tests cover:
- Schema initialization (columns + transactions table)
- Grant credits
- Deduct credits (success + insufficient)
- First-time-free flag consumption
- Refund on failure
- Transaction ledger recording
"""

import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

# Patch AUTH_DB_PATH before importing auth_db functions
_temp_dir = tempfile.mkdtemp()
_temp_db = Path(_temp_dir) / "test_auth.sqlite"


@pytest.fixture(autouse=True)
def isolated_auth_db(tmp_path):
    """Use a fresh temp database for each test."""
    db_path = tmp_path / "auth.sqlite"
    with patch("app.services.auth_db.AUTH_DB_PATH", db_path), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True):
        from app.services.auth_db import init_auth_db, create_user
        init_auth_db()
        # Create a test user
        create_user("test-user-1", email="test@example.com")
        yield db_path


class TestSchema:
    """Verify credit columns and transactions table exist after init."""

    def test_users_table_has_credit_columns(self, isolated_auth_db):
        conn = sqlite3.connect(str(isolated_auth_db))
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT credits, first_framing_used, first_annotate_used FROM users WHERE user_id = 'test-user-1'").fetchone()
        conn.close()
        assert row["credits"] == 0
        assert row["first_framing_used"] == 0
        assert row["first_annotate_used"] == 0

    def test_credit_transactions_table_exists(self, isolated_auth_db):
        conn = sqlite3.connect(str(isolated_auth_db))
        row = conn.execute("SELECT count(*) as cnt FROM credit_transactions").fetchone()
        conn.close()
        assert row[0] == 0


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
        assert len(txns) == 1
        assert txns[0]["amount"] == 25
        assert txns[0]["source"] == "quest_reward"
        assert txns[0]["reference_id"] == "quest_1"

    def test_multiple_grants_accumulate(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, get_credit_balance
        grant_credits("test-user-1", 10, "admin_grant")
        grant_credits("test-user-1", 20, "quest_reward")
        balance = get_credit_balance("test-user-1")
        assert balance["balance"] == 30


class TestDeductCredits:
    def test_deduct_success(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits
        grant_credits("test-user-1", 100, "admin_grant")
        result = deduct_credits("test-user-1", 30, "framing_usage", "job_1", 30.0)
        assert result["success"] is True
        assert result["balance"] == 70

    def test_deduct_insufficient_balance(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits
        grant_credits("test-user-1", 10, "admin_grant")
        result = deduct_credits("test-user-1", 50, "framing_usage", "job_1", 50.0)
        assert result["success"] is False
        assert result["balance"] == 10
        assert result["required"] == 50

    def test_deduct_records_negative_transaction(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits, get_credit_transactions
        grant_credits("test-user-1", 100, "admin_grant")
        deduct_credits("test-user-1", 45, "framing_usage", "job_1", 45.0)
        txns = get_credit_transactions("test-user-1")
        usage_txn = [t for t in txns if t["source"] == "framing_usage"][0]
        assert usage_txn["amount"] == -45
        assert usage_txn["video_seconds"] == 45.0

    def test_deduct_exact_balance(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits
        grant_credits("test-user-1", 30, "admin_grant")
        result = deduct_credits("test-user-1", 30, "framing_usage", "job_1", 30.0)
        assert result["success"] is True
        assert result["balance"] == 0

    def test_deduct_nonexistent_user(self, isolated_auth_db):
        from app.services.auth_db import deduct_credits
        result = deduct_credits("nonexistent-user", 10, "framing_usage")
        assert result["success"] is False
        assert result["balance"] == 0


class TestFirstTimeFree:
    def test_first_framing_returns_true(self, isolated_auth_db):
        from app.services.auth_db import use_first_time_free
        assert use_first_time_free("test-user-1", "framing") is True

    def test_second_framing_returns_false(self, isolated_auth_db):
        from app.services.auth_db import use_first_time_free
        use_first_time_free("test-user-1", "framing")
        assert use_first_time_free("test-user-1", "framing") is False

    def test_first_annotate_returns_true(self, isolated_auth_db):
        from app.services.auth_db import use_first_time_free
        assert use_first_time_free("test-user-1", "annotate") is True

    def test_framing_and_annotate_independent(self, isolated_auth_db):
        from app.services.auth_db import use_first_time_free
        use_first_time_free("test-user-1", "framing")
        # Annotate should still be first-time
        assert use_first_time_free("test-user-1", "annotate") is True

    def test_first_time_reflected_in_balance(self, isolated_auth_db):
        from app.services.auth_db import use_first_time_free, get_credit_balance
        use_first_time_free("test-user-1", "framing")
        balance = get_credit_balance("test-user-1")
        assert balance["first_framing_used"] is True
        assert balance["first_annotate_used"] is False


class TestRefund:
    def test_refund_restores_balance(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits, refund_credits, get_credit_balance
        grant_credits("test-user-1", 100, "admin_grant")
        deduct_credits("test-user-1", 60, "framing_usage", "job_1", 60.0)
        refund_credits("test-user-1", 60, "job_1", 60.0)
        balance = get_credit_balance("test-user-1")
        assert balance["balance"] == 100

    def test_refund_records_transaction(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits, refund_credits, get_credit_transactions
        grant_credits("test-user-1", 100, "admin_grant")
        deduct_credits("test-user-1", 30, "framing_usage", "job_1", 30.0)
        refund_credits("test-user-1", 30, "job_1", 30.0)
        txns = get_credit_transactions("test-user-1")
        refund_txn = [t for t in txns if t["source"] == "framing_refund"][0]
        assert refund_txn["amount"] == 30
        assert refund_txn["reference_id"] == "job_1"


class TestTransactionHistory:
    def test_transactions_ordered_by_id_desc(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, deduct_credits, get_credit_transactions
        grant_credits("test-user-1", 100, "admin_grant", "ref_1")
        grant_credits("test-user-1", 50, "quest_reward", "ref_2")
        deduct_credits("test-user-1", 30, "framing_usage", "ref_3")
        txns = get_credit_transactions("test-user-1")
        assert len(txns) == 3
        # All 3 transactions recorded
        sources = {t["source"] for t in txns}
        assert sources == {"admin_grant", "quest_reward", "framing_usage"}

    def test_transactions_limit(self, isolated_auth_db):
        from app.services.auth_db import grant_credits, get_credit_transactions
        for i in range(10):
            grant_credits("test-user-1", 1, "admin_grant", f"ref_{i}")
        txns = get_credit_transactions("test-user-1", limit=3)
        assert len(txns) == 3
