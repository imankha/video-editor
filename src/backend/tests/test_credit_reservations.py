"""
Tests for credit reservation lifecycle (T890: Export Transaction Atomicity).

Tests cover:
- Reserve credits (success + insufficient funds)
- Confirm reservation (deduct permanently)
- Release reservation (refund on failure)
- Multiple concurrent reservations
- Orphaned reservation recovery
- Full export lifecycle (reserve → confirm)
- Failed export lifecycle (reserve → release)
"""

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def isolated_user_db(tmp_path):
    """Use fresh temp databases for each test.

    Patches USER_DATA_BASE and clears the initialized set so each test
    gets a clean user.sqlite.
    """
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


USER_ID = "test-user-1"


def _grant(amount, source="test_grant"):
    from app.services.user_db import grant_credits
    grant_credits(USER_ID, amount, source)


def _balance():
    from app.services.user_db import get_credit_balance
    return get_credit_balance(USER_ID)["balance"]


def _reservation_rows():
    """Return all credit_reservation rows for the test user."""
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(USER_ID) as conn:
        return conn.execute("SELECT * FROM credit_reservations").fetchall()


def _transaction_rows(source=None):
    """Return credit_transaction rows, optionally filtered by source."""
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(USER_ID) as conn:
        if source:
            return conn.execute(
                "SELECT * FROM credit_transactions WHERE source = ?", (source,)
            ).fetchall()
        return conn.execute("SELECT * FROM credit_transactions").fetchall()


class TestReserveCredits:
    """Reserve credits: deducts balance, creates reservation row."""

    def test_reserve_success(self):
        from app.services.user_db import reserve_credits
        _grant(100)
        result = reserve_credits(USER_ID, 30, "job_1")

        assert result["success"] is True
        assert result["balance"] == 70
        assert result["required"] == 30
        assert _balance() == 70

        rows = _reservation_rows()
        assert len(rows) == 1
        assert rows[0]["job_id"] == "job_1"
        assert rows[0]["amount"] == 30

    def test_reserve_insufficient_funds(self):
        from app.services.user_db import reserve_credits
        _grant(10)
        result = reserve_credits(USER_ID, 30, "job_1")

        assert result["success"] is False
        assert result["balance"] == 10
        assert result["required"] == 30
        assert _balance() == 10

        rows = _reservation_rows()
        assert len(rows) == 0


class TestConfirmReservation:
    """Confirm: deletes reservation, creates credit_transaction."""

    def test_confirm_existing(self):
        from app.services.user_db import reserve_credits, confirm_reservation
        _grant(100)
        reserve_credits(USER_ID, 30, "job_1")

        assert confirm_reservation(USER_ID, "job_1") is True

        # Reservation removed
        assert len(_reservation_rows()) == 0
        # Balance unchanged (already deducted at reserve time)
        assert _balance() == 70
        # Transaction recorded
        txns = _transaction_rows(source="framing_usage")
        assert len(txns) == 1
        assert txns[0]["amount"] == -30
        assert txns[0]["reference_id"] == "job_1"

    def test_confirm_nonexistent(self):
        from app.services.user_db import confirm_reservation
        assert confirm_reservation(USER_ID, "no_such_job") is False


class TestReleaseReservation:
    """Release: deletes reservation, restores balance."""

    def test_release_existing(self):
        from app.services.user_db import reserve_credits, release_reservation
        _grant(100)
        reserve_credits(USER_ID, 30, "job_1")

        assert release_reservation(USER_ID, "job_1") is True

        assert len(_reservation_rows()) == 0
        assert _balance() == 100

    def test_release_nonexistent(self):
        from app.services.user_db import release_reservation
        assert release_reservation(USER_ID, "no_such_job") is False


class TestMultipleReservations:
    """Multiple concurrent reservations with mixed confirm/release."""

    def test_multiple_reserve_confirm_release(self):
        from app.services.user_db import (
            reserve_credits, confirm_reservation, release_reservation,
        )
        _grant(100)

        r1 = reserve_credits(USER_ID, 30, "job_1")
        assert r1["success"] is True
        assert r1["balance"] == 70

        r2 = reserve_credits(USER_ID, 40, "job_2")
        assert r2["success"] is True
        assert r2["balance"] == 30

        assert len(_reservation_rows()) == 2

        # Confirm job_1 (30 consumed permanently)
        confirm_reservation(USER_ID, "job_1")
        # Release job_2 (40 refunded)
        release_reservation(USER_ID, "job_2")

        assert _balance() == 70  # 100 - 30 consumed = 70
        assert len(_reservation_rows()) == 0


class TestRecoverOrphanedReservations:
    """Recover reservations older than 60s."""

    def test_recover_old_reservation(self):
        from app.services.user_db import (
            reserve_credits, recover_orphaned_reservations,
            get_user_db_connection,
        )
        _grant(100)
        reserve_credits(USER_ID, 30, "old_job")

        # Backdate the reservation to 2 minutes ago
        with get_user_db_connection(USER_ID) as conn:
            conn.execute(
                "UPDATE credit_reservations SET created_at = datetime('now', '-120 seconds') "
                "WHERE job_id = 'old_job'"
            )
            conn.commit()

        count = recover_orphaned_reservations(USER_ID)
        assert count == 1
        assert _balance() == 100
        assert len(_reservation_rows()) == 0

    def test_recent_reservation_not_recovered(self):
        from app.services.user_db import reserve_credits, recover_orphaned_reservations
        _grant(100)
        reserve_credits(USER_ID, 30, "recent_job")

        count = recover_orphaned_reservations(USER_ID)
        assert count == 0
        assert _balance() == 70  # Still reserved
        assert len(_reservation_rows()) == 1


class TestExportLifecycle:
    """Integration: full export success and failure paths."""

    def test_success_lifecycle(self):
        """Grant → reserve → confirm → verify final state."""
        from app.services.user_db import reserve_credits, confirm_reservation
        _grant(100)

        reserve_credits(USER_ID, 30, "job_1")
        confirm_reservation(USER_ID, "job_1")

        assert _balance() == 70
        assert len(_reservation_rows()) == 0
        txns = _transaction_rows(source="framing_usage")
        assert len(txns) == 1
        assert txns[0]["amount"] == -30

    def test_failure_lifecycle(self):
        """Grant → reserve → release → verify full refund."""
        from app.services.user_db import reserve_credits, release_reservation
        _grant(100)

        reserve_credits(USER_ID, 30, "job_1")
        release_reservation(USER_ID, "job_1")

        assert _balance() == 100
        assert len(_reservation_rows()) == 0
        txns = _transaction_rows(source="framing_usage")
        assert len(txns) == 0
