"""
T6090: scripts/delete_user.py must clear the T5840 credit ledger
(credits / credit_transactions / credit_reservations), or a deleted user
re-created with the same user_id silently inherits a stale balance.

Loads scripts/delete_user.py by file path (it is a standalone operator
script, not an installed package) and drives its functions against the
real dev Postgres via the shared `pg_conn` fixture (guarded: refuses
staging/prod DSNs).
"""
import importlib.util
import sys
from pathlib import Path

import psycopg2
import pytest
from psycopg2.extras import RealDictCursor

SCRIPT_PATH = Path(__file__).parent.parent.parent.parent / "scripts" / "delete_user.py"


def _load_delete_user_module():
    spec = importlib.util.spec_from_file_location("delete_user_script", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["delete_user_script"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def delete_user_module():
    return _load_delete_user_module()


_ALL_TEST_USER_IDS = (
    "t6090_test_user", "t6090_live_user", "t6090_orphan_user", "t6090_orphan_dry_run",
)


class _FakeS3:
    """delete_one() always calls purge_r2_prefix(); this test drives Postgres
    only, so stub R2 to a no-op paginator instead of touching real storage."""

    def get_paginator(self, _name):
        return self

    def paginate(self, **_kwargs):
        return []


@pytest.fixture
def fake_s3():
    return _FakeS3()


@pytest.fixture
def pg_conn(pg_conn):
    """The shared `pg_conn` fixture yields a guarded (dev-only) DSN string, not
    a live connection. Open a real connection to it for direct SQL access --
    still guarded by the base fixture's staging/prod DSN refusal."""
    conn = psycopg2.connect(pg_conn, cursor_factory=RealDictCursor)
    _cleanup(conn)
    yield conn
    conn.rollback()
    _cleanup(conn)
    conn.close()


def _cleanup(conn):
    cur = conn.cursor()
    placeholders = ",".join(["%s"] * len(_ALL_TEST_USER_IDS))
    for table in ("user_segments", "credit_reservations", "credit_transactions", "credits"):
        cur.execute(f"DELETE FROM {table} WHERE user_id IN ({placeholders})", _ALL_TEST_USER_IDS)
    cur.execute(f"DELETE FROM users WHERE user_id IN ({placeholders})", _ALL_TEST_USER_IDS)
    conn.commit()


TEST_USER_ID = "t6090_test_user"
TEST_EMAIL = "t6090@example.test"


def _seed_user_with_credits(pg_conn, user_id=TEST_USER_ID, email=TEST_EMAIL, balance=395):
    cur = pg_conn.cursor()
    cur.execute(
        "INSERT INTO users (user_id, email) VALUES (%s, %s) "
        "ON CONFLICT (user_id) DO NOTHING",
        (user_id, email),
    )
    cur.execute(
        "INSERT INTO credits (user_id, balance) VALUES (%s, %s) "
        "ON CONFLICT (user_id) DO UPDATE SET balance = EXCLUDED.balance",
        (user_id, balance),
    )
    cur.execute(
        "INSERT INTO credit_transactions (user_id, amount, source, idempotency_key) "
        "VALUES (%s, %s, 'admin_grant', %s)",
        (user_id, balance, f"t6090-seed-{user_id}"),
    )
    cur.execute(
        "INSERT INTO credit_reservations (job_id, user_id, amount) VALUES (%s, %s, %s)",
        (f"t6090-job-{user_id}", user_id, 5),
    )
    pg_conn.commit()


class TestDeleteOneClearsCreditLedger:
    def test_dry_run_reports_credit_tables_without_mutating(self, pg_conn, delete_user_module, fake_s3, capsys):
        _seed_user_with_credits(pg_conn)

        delete_user_module.delete_one(
            TEST_USER_ID, TEST_EMAIL, "dev", "unused-bucket",
            s3=fake_s3, pg_conn=pg_conn, dry_run=True,
        )
        pg_conn.commit()

        out = capsys.readouterr().out
        assert "credits" in out
        assert "credit_transactions" in out
        assert "credit_reservations" in out

        cur = pg_conn.cursor()
        cur.execute("SELECT balance FROM credits WHERE user_id = %s", (TEST_USER_ID,))
        row = cur.fetchone()
        assert row is not None and row["balance"] == 395, (
            "dry-run must not mutate credits"
        )

    def test_real_delete_removes_all_three_credit_tables(self, pg_conn, delete_user_module, fake_s3):
        _seed_user_with_credits(pg_conn)

        delete_user_module.delete_one(
            TEST_USER_ID, TEST_EMAIL, "dev", "unused-bucket",
            s3=fake_s3, pg_conn=pg_conn, dry_run=False,
        )
        pg_conn.commit()

        cur = pg_conn.cursor()
        for table in ("credits", "credit_transactions", "credit_reservations"):
            cur.execute(f"SELECT COUNT(*) as cnt FROM {table} WHERE user_id = %s", (TEST_USER_ID,))
            assert cur.fetchone()["cnt"] == 0, f"{table} row survived delete_one"

    def test_recreated_user_starts_with_no_inherited_balance(self, pg_conn, delete_user_module, fake_s3):
        """The actual observed staging failure: delete then re-create the same
        user_id must NOT come back with the old balance (imankh: 395, arshia: 28)."""
        _seed_user_with_credits(pg_conn, balance=395)

        delete_user_module.delete_one(
            TEST_USER_ID, TEST_EMAIL, "dev", "unused-bucket",
            s3=fake_s3, pg_conn=pg_conn, dry_run=False,
        )
        pg_conn.commit()

        # Re-create the same user_id (simulates a fresh signup / copied account).
        cur = pg_conn.cursor()
        cur.execute("INSERT INTO users (user_id, email) VALUES (%s, %s)", (TEST_USER_ID, TEST_EMAIL))
        cur.execute("INSERT INTO credits (user_id, balance) VALUES (%s, 0)", (TEST_USER_ID,))
        pg_conn.commit()

        cur.execute("SELECT balance FROM credits WHERE user_id = %s", (TEST_USER_ID,))
        assert cur.fetchone()["balance"] == 0


class TestPreV019Guard:
    def test_delete_one_survives_missing_credit_tables(self, pg_conn, delete_user_module, fake_s3):
        """Simulate a pre-v019 destination (prod today): the credit tables don't
        exist at all. delete_one must not crash. Dropped inside the pg_conn
        transaction and never committed, so the shared dev schema is restored
        for every other test."""
        _seed_user_with_credits(pg_conn)
        pg_conn.commit()

        cur = pg_conn.cursor()
        cur.execute("DROP TABLE credit_reservations, credit_transactions, credits CASCADE")

        try:
            delete_user_module.delete_one(
                TEST_USER_ID, TEST_EMAIL, "dev", "unused-bucket",
                s3=fake_s3, pg_conn=pg_conn, dry_run=False,
            )
            # users row must still be gone -- the rest of delete_one must still run.
            cur.execute("SELECT COUNT(*) as cnt FROM users WHERE user_id = %s", (TEST_USER_ID,))
            assert cur.fetchone()["cnt"] == 0
        finally:
            pg_conn.rollback()


class TestSweepOrphans:
    def test_sweep_removes_only_orphaned_rows(self, pg_conn, delete_user_module):
        """A live user's credit rows must be untouchable by the sweep -- only
        rows whose user_id has no matching `users` row may be removed."""
        live_user_id = "t6090_live_user"
        orphan_user_id = "t6090_orphan_user"

        _seed_user_with_credits(pg_conn, user_id=live_user_id, email="live@example.test", balance=50)

        # Orphan: credit rows with NO matching users row (exactly what today's
        # delete_user.py bug leaves behind).
        cur = pg_conn.cursor()
        cur.execute("INSERT INTO credits (user_id, balance) VALUES (%s, %s)", (orphan_user_id, 999))
        cur.execute(
            "INSERT INTO credit_transactions (user_id, amount, source, idempotency_key) "
            "VALUES (%s, %s, 'admin_grant', %s)",
            (orphan_user_id, 999, "t6090-orphan-seed"),
        )
        cur.execute(
            "INSERT INTO credit_reservations (job_id, user_id, amount) VALUES (%s, %s, %s)",
            ("t6090-orphan-job", orphan_user_id, 5),
        )
        pg_conn.commit()

        removed = delete_user_module.sweep_orphans(pg_conn, dry_run=False)
        pg_conn.commit()

        # This dev DB may carry other pre-existing orphaned rows from unrelated
        # test/dev sessions -- assert our 3 synthetic rows are included in the
        # sweep, not an exact total (that would make the test order-dependent
        # on unrelated dev-DB state).
        assert removed >= 3

        cur.execute("SELECT COUNT(*) as cnt FROM credits WHERE user_id = %s", (orphan_user_id,))
        assert cur.fetchone()["cnt"] == 0
        cur.execute("SELECT COUNT(*) as cnt FROM credit_transactions WHERE user_id = %s", (orphan_user_id,))
        assert cur.fetchone()["cnt"] == 0
        cur.execute("SELECT COUNT(*) as cnt FROM credit_reservations WHERE user_id = %s", (orphan_user_id,))
        assert cur.fetchone()["cnt"] == 0

        # Live user's rows must be untouched.
        cur.execute("SELECT balance FROM credits WHERE user_id = %s", (live_user_id,))
        assert cur.fetchone()["balance"] == 50
        cur.execute("SELECT COUNT(*) as cnt FROM credit_transactions WHERE user_id = %s", (live_user_id,))
        assert cur.fetchone()["cnt"] == 1
        cur.execute("SELECT COUNT(*) as cnt FROM credit_reservations WHERE user_id = %s", (live_user_id,))
        assert cur.fetchone()["cnt"] == 1

    def test_sweep_dry_run_mutates_nothing(self, pg_conn, delete_user_module):
        orphan_user_id = "t6090_orphan_dry_run"
        cur = pg_conn.cursor()
        cur.execute("INSERT INTO credits (user_id, balance) VALUES (%s, %s)", (orphan_user_id, 10))
        pg_conn.commit()

        removed = delete_user_module.sweep_orphans(pg_conn, dry_run=True)
        pg_conn.commit()

        assert removed == 1
        cur.execute("SELECT COUNT(*) as cnt FROM credits WHERE user_id = %s", (orphan_user_id,))
        assert cur.fetchone()["cnt"] == 1, "dry-run must not mutate"
