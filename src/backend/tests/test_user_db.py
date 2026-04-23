"""
Tests for T920 user-level database (user_db.py).

Covers:
- Schema creation (5 tables)
- Credit CRUD (grant, deduct, refund, set, get_balance)
- Idempotency via UNIQUE index on (user_id, source, reference_id)
- Stripe customer ID roundtrip
- Transaction ordering and limits
- has_processed_payment
- Reservation lifecycle (reserve, confirm, release, insufficient, orphan recovery)
- User isolation
- Credit summary sync to auth.sqlite
- Migration from auth.sqlite
"""

import sqlite3
import time
from unittest.mock import patch, MagicMock

import pytest


@pytest.fixture(autouse=True)
def isolated_user_db(tmp_path):
    """Fresh temp databases for each test.

    Patches auth.sqlite path, user_db USER_DATA_BASE, and clears
    the initialized-DB cache so every test starts clean.
    """
    auth_db_path = tmp_path / "auth.sqlite"
    user_data_base = tmp_path / "user_data"
    user_data_base.mkdir()

    with patch("app.services.auth_db.AUTH_DB_PATH", auth_db_path), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True), \
         patch("app.services.user_db.USER_DATA_BASE", user_data_base), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.services.user_db._update_credit_summary") as mock_summary:
        from app.services.auth_db import init_auth_db, create_user
        init_auth_db()
        create_user("user-a", email="a@example.com")
        create_user("user-b", email="b@example.com")
        yield {
            "tmp_path": tmp_path,
            "user_data_base": user_data_base,
            "mock_summary": mock_summary,
        }


# -----------------------------------------------------------------------
# 1. Schema creation
# -----------------------------------------------------------------------

class TestSchemaCreation:
    def test_ensure_user_database_creates_all_tables(self, isolated_user_db):
        from app.services.user_db import ensure_user_database, _get_user_db_path
        ensure_user_database("user-a")
        db_path = _get_user_db_path("user-a")
        assert db_path.exists()

        conn = sqlite3.connect(str(db_path))
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        conn.close()

        expected = {"credits", "credit_transactions", "credit_reservations",
                    "stripe_customers"}
        assert expected.issubset(tables), f"Missing tables: {expected - tables}"

    def test_ensure_user_database_idempotent(self, isolated_user_db):
        from app.services.user_db import ensure_user_database
        # Calling twice should not raise
        ensure_user_database("user-a")
        ensure_user_database("user-a")


# -----------------------------------------------------------------------
# 2. Credit CRUD
# -----------------------------------------------------------------------

class TestGrantCredits:
    def test_grant_increases_balance(self, isolated_user_db):
        from app.services.user_db import grant_credits, get_credit_balance
        new = grant_credits("user-a", 50, "admin_grant", "ref1")
        assert new == 50
        assert get_credit_balance("user-a")["balance"] == 50

    def test_grant_records_transaction(self, isolated_user_db):
        from app.services.user_db import grant_credits, get_credit_transactions
        grant_credits("user-a", 25, "quest_reward", "q1")
        txns = get_credit_transactions("user-a")
        assert len(txns) == 1
        assert txns[0]["amount"] == 25
        assert txns[0]["source"] == "quest_reward"
        assert txns[0]["reference_id"] == "q1"


class TestDeductCredits:
    def test_deduct_success(self, isolated_user_db):
        from app.services.user_db import grant_credits, deduct_credits
        grant_credits("user-a", 30, "admin_grant")
        result = deduct_credits("user-a", 10, "framing_usage", "job1", 10.0)
        assert result["success"] is True
        assert result["balance"] == 20

    def test_deduct_insufficient_funds(self, isolated_user_db):
        from app.services.user_db import grant_credits, deduct_credits, get_credit_balance
        grant_credits("user-a", 5, "admin_grant")
        result = deduct_credits("user-a", 50, "framing_usage", "job1")
        assert result["success"] is False
        # Balance unchanged
        assert get_credit_balance("user-a")["balance"] == 5

    def test_deduct_records_negative_transaction(self, isolated_user_db):
        from app.services.user_db import grant_credits, deduct_credits, get_credit_transactions
        grant_credits("user-a", 20, "admin_grant")
        deduct_credits("user-a", 15, "framing_usage", "job1", 15.0)
        txns = get_credit_transactions("user-a")
        usage = [t for t in txns if t["source"] == "framing_usage"][0]
        assert usage["amount"] == -15
        assert usage["video_seconds"] == 15.0


class TestRefundCredits:
    def test_refund_increases_balance(self, isolated_user_db):
        from app.services.user_db import grant_credits, deduct_credits, refund_credits, get_credit_balance
        grant_credits("user-a", 20, "admin_grant")
        deduct_credits("user-a", 15, "framing_usage", "job1", 15.0)
        refund_credits("user-a", 15, "job1", 15.0)
        assert get_credit_balance("user-a")["balance"] == 20

    def test_refund_source_is_framing_refund(self, isolated_user_db):
        from app.services.user_db import grant_credits, deduct_credits, refund_credits, get_credit_transactions
        grant_credits("user-a", 20, "admin_grant")
        deduct_credits("user-a", 10, "framing_usage", "job1")
        refund_credits("user-a", 10, "job1")
        txns = get_credit_transactions("user-a")
        refund_txn = [t for t in txns if t["source"] == "framing_refund"][0]
        assert refund_txn["amount"] == 10
        assert refund_txn["reference_id"] == "job1"


class TestSetCredits:
    def test_set_credits_exact_value(self, isolated_user_db):
        from app.services.user_db import grant_credits, set_credits, get_credit_balance
        grant_credits("user-a", 100, "admin_grant")
        result = set_credits("user-a", 42)
        assert result == 42
        assert get_credit_balance("user-a")["balance"] == 42

    def test_set_credits_records_delta_transaction(self, isolated_user_db):
        from app.services.user_db import grant_credits, set_credits, get_credit_transactions
        grant_credits("user-a", 100, "admin_grant")
        set_credits("user-a", 60)
        txns = get_credit_transactions("user-a")
        admin_set_txn = [t for t in txns if t["source"] == "admin_set"][0]
        assert admin_set_txn["amount"] == -40  # delta: 60 - 100
        assert admin_set_txn["reference_id"] == "set_to_60"


class TestGetCreditBalance:
    def test_nonexistent_user_returns_zero(self, isolated_user_db):
        from app.services.user_db import get_credit_balance
        result = get_credit_balance("nonexistent-user")
        assert result == {"balance": 0}


# -----------------------------------------------------------------------
# 3. Idempotency (UNIQUE index)
# -----------------------------------------------------------------------

class TestIdempotency:
    def test_duplicate_reference_id_raises_integrity_error(self, isolated_user_db):
        from app.services.user_db import grant_credits
        grant_credits("user-a", 10, "stripe_purchase", "pi_123")
        with pytest.raises(sqlite3.IntegrityError):
            grant_credits("user-a", 10, "stripe_purchase", "pi_123")

    def test_null_reference_id_allows_duplicates(self, isolated_user_db):
        from app.services.user_db import grant_credits, get_credit_balance
        grant_credits("user-a", 10, "admin_grant", None)
        grant_credits("user-a", 10, "admin_grant", None)
        assert get_credit_balance("user-a")["balance"] == 20


# -----------------------------------------------------------------------
# 4. Stripe
# -----------------------------------------------------------------------

class TestStripe:
    def test_stripe_customer_id_roundtrip(self, isolated_user_db):
        from app.services.user_db import set_stripe_customer_id, get_stripe_customer_id
        set_stripe_customer_id("user-a", "cus_abc123")
        assert get_stripe_customer_id("user-a") == "cus_abc123"

    def test_stripe_customer_id_not_set(self, isolated_user_db):
        from app.services.user_db import get_stripe_customer_id
        assert get_stripe_customer_id("user-a") is None


# -----------------------------------------------------------------------
# 5. Transactions
# -----------------------------------------------------------------------

class TestTransactions:
    def test_ordered_by_created_at_desc(self, isolated_user_db):
        from app.services.user_db import grant_credits, get_credit_transactions, _get_user_db_path
        # Insert transactions with distinct created_at so ordering is deterministic
        db_path = _get_user_db_path("user-a")
        grant_credits("user-a", 1, "src_1", "ref_1")

        # Manually backdate the first transaction so ordering is clear
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            "UPDATE credit_transactions SET created_at = datetime('now', '-10 seconds') "
            "WHERE reference_id = 'ref_1'"
        )
        conn.commit()
        conn.close()

        grant_credits("user-a", 2, "src_2", "ref_2")
        grant_credits("user-a", 3, "src_3", "ref_3")
        txns = get_credit_transactions("user-a")
        # Most recent first; ref_1 was backdated so it should be last
        assert txns[-1]["amount"] == 1
        assert txns[-1]["reference_id"] == "ref_1"
        assert len(txns) == 3

    def test_respects_limit(self, isolated_user_db):
        from app.services.user_db import grant_credits, get_credit_transactions
        for i in range(10):
            grant_credits("user-a", 1, f"src_{i}", f"ref_{i}")
        txns = get_credit_transactions("user-a", limit=3)
        assert len(txns) == 3


# -----------------------------------------------------------------------
# 6. has_processed_payment
# -----------------------------------------------------------------------

class TestHasProcessedPayment:
    def test_false_before_payment(self, isolated_user_db):
        from app.services.user_db import has_processed_payment
        assert has_processed_payment("user-a", "pi_999") is False

    def test_true_after_stripe_purchase(self, isolated_user_db):
        from app.services.user_db import grant_credits, has_processed_payment
        grant_credits("user-a", 100, "stripe_purchase", "pi_999")
        assert has_processed_payment("user-a", "pi_999") is True

    def test_false_for_non_stripe_source(self, isolated_user_db):
        from app.services.user_db import grant_credits, has_processed_payment
        grant_credits("user-a", 100, "admin_grant", "pi_999")
        assert has_processed_payment("user-a", "pi_999") is False


# -----------------------------------------------------------------------
# 7. Reservation lifecycle
# -----------------------------------------------------------------------

class TestReservations:
    def test_reserve_drops_balance(self, isolated_user_db):
        from app.services.user_db import grant_credits, reserve_credits, get_credit_balance
        grant_credits("user-a", 50, "admin_grant")
        result = reserve_credits("user-a", 20, "job-1", 10.0)
        assert result["success"] is True
        assert result["balance"] == 30
        assert get_credit_balance("user-a")["balance"] == 30

    def test_confirm_reservation(self, isolated_user_db):
        from app.services.user_db import (
            grant_credits, reserve_credits, confirm_reservation,
            get_credit_balance, get_credit_transactions,
        )
        grant_credits("user-a", 50, "admin_grant")
        reserve_credits("user-a", 20, "job-1", 10.0)
        ok = confirm_reservation("user-a", "job-1")
        assert ok is True
        # Balance stays at 30 (already deducted during reserve)
        assert get_credit_balance("user-a")["balance"] == 30
        # Transaction recorded
        txns = get_credit_transactions("user-a")
        usage_txn = [t for t in txns if t["source"] == "framing_usage"][0]
        assert usage_txn["amount"] == -20
        assert usage_txn["reference_id"] == "job-1"

    def test_confirm_nonexistent_reservation_returns_false(self, isolated_user_db):
        from app.services.user_db import confirm_reservation
        assert confirm_reservation("user-a", "nonexistent") is False

    def test_release_reservation_restores_balance(self, isolated_user_db):
        from app.services.user_db import (
            grant_credits, reserve_credits, release_reservation, get_credit_balance,
        )
        grant_credits("user-a", 50, "admin_grant")
        reserve_credits("user-a", 20, "job-1")
        ok = release_reservation("user-a", "job-1")
        assert ok is True
        assert get_credit_balance("user-a")["balance"] == 50

    def test_release_nonexistent_reservation_returns_false(self, isolated_user_db):
        from app.services.user_db import release_reservation
        assert release_reservation("user-a", "nonexistent") is False

    def test_reserve_insufficient_funds(self, isolated_user_db):
        from app.services.user_db import grant_credits, reserve_credits, get_credit_balance
        grant_credits("user-a", 5, "admin_grant")
        result = reserve_credits("user-a", 50, "job-1")
        assert result["success"] is False
        # No change
        assert get_credit_balance("user-a")["balance"] == 5

    def test_recover_orphaned_reservations(self, isolated_user_db):
        """Old reservations (>60s) should be released by recovery."""
        from app.services.user_db import (
            grant_credits, get_credit_balance,
            recover_orphaned_reservations, _get_user_db_path,
            ensure_user_database,
        )
        grant_credits("user-a", 100, "admin_grant")

        # Manually insert a reservation with old created_at
        db_path = _get_user_db_path("user-a")
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            "UPDATE credits SET balance = balance - 30 WHERE user_id = 'user-a'"
        )
        conn.execute(
            "INSERT INTO credit_reservations (job_id, amount, video_seconds, created_at) "
            "VALUES ('old-job', 30, 15.0, datetime('now', '-120 seconds'))"
        )
        conn.commit()
        conn.close()

        count = recover_orphaned_reservations("user-a")
        assert count == 1
        assert get_credit_balance("user-a")["balance"] == 100


# -----------------------------------------------------------------------
# 8. User isolation
# -----------------------------------------------------------------------

class TestUserIsolation:
    def test_operations_on_user_a_dont_affect_user_b(self, isolated_user_db):
        from app.services.user_db import grant_credits, get_credit_balance
        grant_credits("user-a", 100, "admin_grant")
        assert get_credit_balance("user-a")["balance"] == 100
        assert get_credit_balance("user-b")["balance"] == 0

    def test_transactions_isolated(self, isolated_user_db):
        from app.services.user_db import grant_credits, get_credit_transactions
        grant_credits("user-a", 50, "admin_grant", "ref-a")
        grant_credits("user-b", 25, "admin_grant", "ref-b")
        txns_a = get_credit_transactions("user-a")
        txns_b = get_credit_transactions("user-b")
        assert len(txns_a) == 1
        assert len(txns_b) == 1
        assert txns_a[0]["reference_id"] == "ref-a"
        assert txns_b[0]["reference_id"] == "ref-b"


# -----------------------------------------------------------------------
# 9. Credit summary sync
# -----------------------------------------------------------------------

class TestCreditSummarySync:
    def test_grant_calls_update_credit_summary(self, isolated_user_db):
        from app.services.user_db import grant_credits
        mock_summary = isolated_user_db["mock_summary"]
        grant_credits("user-a", 50, "admin_grant")
        mock_summary.assert_called_with("user-a", 50)

    def test_refund_calls_update_credit_summary(self, isolated_user_db):
        from app.services.user_db import grant_credits, deduct_credits, refund_credits
        mock_summary = isolated_user_db["mock_summary"]
        grant_credits("user-a", 50, "admin_grant")
        deduct_credits("user-a", 20, "framing_usage", "job1")
        mock_summary.reset_mock()
        refund_credits("user-a", 20, "job1")
        mock_summary.assert_called_with("user-a", 50)

    def test_set_credits_calls_update_credit_summary(self, isolated_user_db):
        from app.services.user_db import set_credits
        mock_summary = isolated_user_db["mock_summary"]
        set_credits("user-a", 75)
        mock_summary.assert_called_with("user-a", 75)


# -----------------------------------------------------------------------
# 10. Migration from auth.sqlite
# -----------------------------------------------------------------------

class TestInitCreditsRow:
    def test_new_user_gets_zero_balance(self, isolated_user_db):
        """New user should get a credits row with balance=0."""
        from app.services.user_db import get_credit_balance
        balance = get_credit_balance("user-a")
        assert balance["balance"] == 0

    def test_init_is_idempotent(self, isolated_user_db):
        """Calling ensure_user_database twice doesn't reset balance."""
        from app.services.user_db import grant_credits, get_credit_balance
        from app.services import user_db

        grant_credits("user-a", 50, "admin_grant")
        user_db._initialized_user_dbs.discard("user-a")
        user_db.ensure_user_database("user-a")

        balance = get_credit_balance("user-a")
        assert balance["balance"] == 50
