"""
Tests for T920 user-level database (user_db.py).

Covers:
- Schema creation (tables still declared in _USER_DB_SCHEMA)
- Stripe customer ID roundtrip

T5840: credit CRUD (grant/deduct/refund/set/get_balance), idempotency,
transactions, has_processed_payment, reservations, and user isolation all
moved to app/services/credit_ledger.py (Postgres) -- see test_credit_ledger.py
and test_credit_ledger_concurrency.py for that coverage. The legacy
`credits`/`credit_transactions`/`credit_reservations` tables stay in
_USER_DB_SCHEMA unread and unwritten (pre-migration record), so
TestSchemaCreation still asserts they exist.
"""

import sqlite3

import pytest


@pytest.fixture(autouse=True)
def isolated_user_db(pg_conn, tmp_path, monkeypatch):
    """Fresh temp databases for each test."""
    user_data_base = tmp_path / "user_data"
    user_data_base.mkdir()
    monkeypatch.setattr("app.services.user_db.USER_DATA_BASE", user_data_base)
    monkeypatch.setattr("app.services.user_db._initialized_user_dbs", set())
    from app.services.auth_db import create_user
    create_user("user-a", email="a@example.com")
    create_user("user-b", email="b@example.com")
    yield {
        "tmp_path": tmp_path,
        "user_data_base": user_data_base,
    }


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

    def test_new_user_db_has_no_credits_row(self, isolated_user_db):
        """T5840: _init_credits_row is gone -- the legacy table stays
        unwritten, not just unread."""
        from app.services.user_db import _get_user_db_path, ensure_user_database
        ensure_user_database("user-a")
        conn = sqlite3.connect(str(_get_user_db_path("user-a")))
        row = conn.execute("SELECT COUNT(*) FROM credits").fetchone()
        conn.close()
        assert row[0] == 0


class TestStripe:
    def test_stripe_customer_id_roundtrip(self, isolated_user_db):
        from app.services.user_db import set_stripe_customer_id, get_stripe_customer_id
        set_stripe_customer_id("user-a", "cus_abc123")
        assert get_stripe_customer_id("user-a") == "cus_abc123"

    def test_stripe_customer_id_not_set(self, isolated_user_db):
        from app.services.user_db import get_stripe_customer_id
        assert get_stripe_customer_id("user-a") is None
