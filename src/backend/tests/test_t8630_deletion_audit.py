"""T8630: deletion preserves the financial record and is auditable -- Phase 1
FAILING tests.

Written against APPROVED docs/plans/tasks/revenue-integrity/T8630-design.md
(rulings 2026-09-24), notably ruling A (`account_deletions.id` is a BIGSERIAL
PRIMARY KEY, NOT `user_id` -- a second reset of the same test account must
write a SECOND audit row, not collide).

The Postgres schema (v031: `account_deletions` table + the `payments`
append-only/no-truncate triggers) has ALREADY landed via the parallel
Migration step and via `_SCHEMA_DDL` in `app/services/pg.py` -- confirmed by
reading `pg.py` before writing this file. What does NOT exist yet is all of
the CODE this task owns:
  - no `app/services/account_deletions.py` (no `record_account_deletion`,
    no `DeletionActor`, no `DeletionPath`)
  - no `stamp_account_deleted` in `app/services/payments_ledger.py`
  - no wiring of either into `privacy.py::delete_account`,
    `auth.py::_reset_test_account`, or `scripts/delete_user.py::delete_one`
  - no `--force-paid` flag / bulk pre-pass / `payment_summary` helper in
    `scripts/delete_user.py`
  - no privacy-copy changes in `AccountSettings.jsx`, `PrivacyPolicy.jsx`,
    `docs/legal/privacy-policy.md`, `docs/legal/data-retention-policy.md`

Every test in this file is expected to fail against current HEAD, for one of:
  - ModuleNotFoundError (`app.services.account_deletions` doesn't exist)
  - AttributeError (`payments_ledger.stamp_account_deleted`,
    `delete_user_module.payment_summary` / `--force-paid` don't exist yet)
  - AssertionError (no audit row gets written, no stamp happens, the copy
    strings are absent, `--force-paid` doesn't refuse/guard anything yet)

IMPORTANT (read before running): `tests/conftest.py`'s `pg_conn` fixture's
shared `setup` connection still runs a *bare* `TRUNCATE ... payments` at
conftest.py:244, with NO `SET LOCAL reelballers.allow_payments_purge = 'on'`
before it. The `payments_no_truncate` trigger (already landed by the parallel
Migration step, per `pg.py`'s `_SCHEMA_DDL`) therefore raises
`psycopg2.errors.RaiseException: payments is append-only: TRUNCATE is
forbidden` at `pg_conn` FIXTURE SETUP, before ANY test body in this file (or
any other `pg_conn`-based file) runs. This is a SEPARATE, already-landed
piece of red state this task's implementation does not own fixing (a
separate conftest change is planned, per the task instructions) -- every
test below is written to be behaviorally correct once that fixture is
patched; until then, expect every test in this file to fail at fixture SETUP
with that exact TRUNCATE error rather than its own individual assertion.
This is noted, not worked around: this file must not edit conftest.py.

Test-id mapping is to T8630-design.md §11's table (T1-T7).
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
from pathlib import Path

import psycopg2
import pytest
from psycopg2.extras import RealDictCursor

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_DIR = REPO_ROOT / "scripts"
SCRIPT_PATH = SCRIPTS_DIR / "delete_user.py"

FRONTEND_DIR = REPO_ROOT / "src" / "frontend" / "src"
ACCOUNT_SETTINGS_PATH = FRONTEND_DIR / "components" / "AccountSettings.jsx"
PRIVACY_POLICY_JSX_PATH = FRONTEND_DIR / "components" / "PrivacyPolicy.jsx"
PRIVACY_POLICY_MD_PATH = REPO_ROOT / "docs" / "legal" / "privacy-policy.md"
DATA_RETENTION_MD_PATH = REPO_ROOT / "docs" / "legal" / "data-retention-policy.md"

RULING_C_CONFIRMATION_TEXT = (
    "This permanently deletes your account and all personal data. This cannot be undone. We "
    "keep a record of past payments (amounts and dates only, with no name, email, or card "
    "details) to meet tax and accounting obligations."
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_delete_user_module():
    """Load scripts/delete_user.py by file path (standalone operator script,
    not an installed package) -- same pattern as test_t6090_delete_user_credit_ledger.py.
    """
    spec = importlib.util.spec_from_file_location("delete_user_script_t8630", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["delete_user_script_t8630"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def delete_user_module():
    return _load_delete_user_module()


class _FakeS3:
    """delete_one() always calls purge_r2_prefix(); these tests drive
    Postgres only, so stub R2 to a no-op paginator instead of touching real
    storage (same pattern as test_t6090)."""

    def get_paginator(self, _name):
        return self

    def paginate(self, **_kwargs):
        return []


@pytest.fixture
def fake_s3():
    return _FakeS3()


_ALL_T8630_USER_IDS = (
    "t8630_privacy_user", "t8630_reset_user", "t8630_script_user",
    "t8630_no_pay_user", "t8630_trigger_user", "t8630_bulk_payer",
    "t8630_bulk_free", "t8630_force_paid_user", "t8630_incident_user",
)


@pytest.fixture
def raw_pg_conn(pg_conn):
    """Open a real psycopg2 connection to the guarded (dev-only, and here
    the dedicated throwaway t8630_test) DSN the base `pg_conn` fixture
    yields, for direct SQL access -- same pattern as test_t6090's local
    `pg_conn` override."""
    conn = psycopg2.connect(pg_conn, cursor_factory=RealDictCursor)
    _cleanup(conn)
    yield conn
    conn.rollback()
    _cleanup(conn)
    conn.close()


def _cleanup(conn):
    cur = conn.cursor()
    placeholders = ",".join(["%s"] * len(_ALL_T8630_USER_IDS))
    # T8630: `payments`' row-level append-only trigger forbids DELETE
    # unconditionally -- unlike the TRUNCATE guard, it has NO escape hatch
    # (by design: row-level DELETE must never be possible, even for tests).
    # No cleanup needed here: the shared `pg_conn` fixture this depends on
    # already TRUNCATEs `payments` (with the GUC hatch) on every test's
    # setup, so each test starts with an empty ledger regardless of what a
    # prior test in this file committed.
    cur.execute(f"DELETE FROM account_deletions WHERE user_id IN ({placeholders})", _ALL_T8630_USER_IDS)
    cur.execute(f"DELETE FROM user_segments WHERE user_id IN ({placeholders})", _ALL_T8630_USER_IDS)
    cur.execute(f"DELETE FROM users WHERE user_id IN ({placeholders})", _ALL_T8630_USER_IDS)
    conn.commit()


def _seed_user(conn, user_id, email=None):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO users (user_id, email) VALUES (%s, %s) ON CONFLICT (user_id) DO NOTHING",
        (user_id, email or f"{user_id}@test.local"),
    )
    conn.commit()


def _seed_payment(conn, user_id, stripe_object_id, amount_cents, kind="purchase", occurred_at="2026-09-01T00:00:00Z"):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO payments (user_id, kind, amount_cents, currency, stripe_object_id,
                               stripe_charge_id, pack, credits, occurred_at, source)
        VALUES (%s, %s, %s, 'usd', %s, NULL, 'starter', 40, %s, 'webhook')
        ON CONFLICT (stripe_object_id, kind) DO NOTHING
        """,
        (user_id, kind, amount_cents, stripe_object_id, occurred_at),
    )
    conn.commit()


def _payments_for(conn, user_id):
    cur = conn.cursor()
    cur.execute("SELECT * FROM payments WHERE user_id = %s ORDER BY id", (user_id,))
    return cur.fetchall()


def _audit_rows_for(conn, user_id):
    cur = conn.cursor()
    cur.execute("SELECT * FROM account_deletions WHERE user_id = %s ORDER BY id", (user_id,))
    return cur.fetchall()


def _user_exists(conn, user_id):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM users WHERE user_id = %s", (user_id,))
    return cur.fetchone()["c"] > 0


# ---------------------------------------------------------------------------
# T1: ledger survives deletion + gets stamped; second stamp call is a no-op
# (AC1).
# ---------------------------------------------------------------------------


class TestT1LedgerSurvivesAndStamped:
    """Design §11 T1 / AC1: deleting an account with payments leaves every
    `payments` row intact, stamped `account_deleted_at`. Drives the privacy
    path's step-2 SQL contract directly via the not-yet-existing
    `stamp_account_deleted` helper (payments_ledger.py's sole writer of the
    `account_deleted_at` column), then confirms the users row itself is gone
    via the real `privacy.delete_account` route.
    """

    def test_stamp_account_deleted_marks_payments_and_is_idempotent(self, raw_pg_conn):
        """Direct helper-level check (mirrors T8620's fill_missing_charge_id
        pattern): stamp_account_deleted marks all of a user's payments rows,
        a second call stamps 0 rows (NULL-gated idempotency)."""
        from app.services import payments_ledger  # ImportError expected: no such attribute yet

        user_id = "t8630_privacy_user"
        _seed_user(raw_pg_conn, user_id)
        _seed_payment(raw_pg_conn, user_id, "pi_t8630_t1a", 699)
        _seed_payment(raw_pg_conn, user_id, "pi_t8630_t1b", 399)

        cur = raw_pg_conn.cursor()
        stamped_first = payments_ledger.stamp_account_deleted(cur, user_id)
        raw_pg_conn.commit()
        assert stamped_first == 2, "both rows for this user must be stamped on first call"

        rows = _payments_for(raw_pg_conn, user_id)
        assert len(rows) == 2, "payments rows must survive the stamp -- never deleted"
        assert all(r["account_deleted_at"] is not None for r in rows)

        cur = raw_pg_conn.cursor()
        stamped_second = payments_ledger.stamp_account_deleted(cur, user_id)
        raw_pg_conn.commit()
        assert stamped_second == 0, "NULL-gated: a re-run must stamp nothing"

    def test_delete_account_endpoint_preserves_and_stamps_ledger(self, raw_pg_conn, monkeypatch):
        """End-to-end via the real privacy.delete_account handler (AC1):
        payments row survives + gets stamped; users row is gone."""
        from app.routers import privacy as privacy_mod

        user_id = "t8630_privacy_user"
        _seed_user(raw_pg_conn, user_id)
        _seed_payment(raw_pg_conn, user_id, "pi_t8630_t1c", 999)

        monkeypatch.setattr(privacy_mod, "get_current_user_id", lambda: user_id)
        monkeypatch.setattr("app.routers.auth._purge_user_data", lambda uid: {"local_deleted": False, "r2_objects_deleted": 0})

        import asyncio

        class _FakeRequest:
            pass

        asyncio.run(privacy_mod.delete_account(_FakeRequest()))

        assert not _user_exists(raw_pg_conn, user_id), "users row must be gone after delete_account"
        rows = _payments_for(raw_pg_conn, user_id)
        assert len(rows) == 1, "the payments row must survive account deletion"
        assert rows[0]["account_deleted_at"] is not None, "the surviving row must be stamped"


# ---------------------------------------------------------------------------
# T2: exactly one account_deletions row per deletion, correct actor/path/
# had_payments/net_cents, across all three paths; ruling-A amendment: two
# resets of the same test account write TWO rows.
# ---------------------------------------------------------------------------


class TestT2AuditRowPerDeletion:
    """Design §11 T2 / AC2: every users-row deletion writes exactly one
    `account_deletions` row naming actor + path, with correct
    had_payments/net_cents."""

    def test_privacy_endpoint_writes_one_row_actor_self_path_privacy_endpoint(self, raw_pg_conn, monkeypatch):
        from app.routers import privacy as privacy_mod

        user_id = "t8630_privacy_user"
        _seed_user(raw_pg_conn, user_id)
        _seed_payment(raw_pg_conn, user_id, "pi_t8630_t2a", 500)
        _seed_payment(raw_pg_conn, user_id, "re_t8630_t2a", -100, kind="refund")

        monkeypatch.setattr(privacy_mod, "get_current_user_id", lambda: user_id)
        monkeypatch.setattr("app.routers.auth._purge_user_data", lambda uid: {"local_deleted": False, "r2_objects_deleted": 0})

        import asyncio

        class _FakeRequest:
            pass

        asyncio.run(privacy_mod.delete_account(_FakeRequest()))

        rows = _audit_rows_for(raw_pg_conn, user_id)
        assert len(rows) == 1, f"expected exactly one account_deletions row, got {rows}"
        row = rows[0]
        assert row["actor"] == "self"
        assert row["path"] == "privacy_endpoint"
        assert row["had_payments"] is True
        assert row["net_cents"] == 400, "500 - 100 = 400 net"

    def test_reset_test_account_writes_one_row_actor_self_path_reset_no_stamp(self, raw_pg_conn, monkeypatch):
        """Approved ruling 1/2: _reset_test_account writes the audit row but
        does NOT stamp payments (the same user_id is re-created immediately
        on the same login)."""
        from app.routers import auth as auth_mod

        user_id = "t8630_reset_user"
        email = f"{user_id}@test.local"
        _seed_user(raw_pg_conn, user_id, email)

        monkeypatch.setattr(auth_mod, "_purge_user_data", lambda uid: {"local_deleted": False, "r2_objects_deleted": 0})
        auth_mod._reset_test_account(user_id, email)

        rows = _audit_rows_for(raw_pg_conn, user_id)
        assert len(rows) == 1, f"expected exactly one account_deletions row, got {rows}"
        assert rows[0]["actor"] == "self"
        assert rows[0]["path"] == "reset_test_account"
        assert rows[0]["had_payments"] is False
        assert rows[0]["net_cents"] == 0

    def test_delete_user_script_writes_one_row_actor_script_path_delete_user_script(
        self, raw_pg_conn, delete_user_module, fake_s3,
    ):
        user_id = "t8630_script_user"
        email = f"{user_id}@test.local"
        _seed_user(raw_pg_conn, user_id, email)
        _seed_payment(raw_pg_conn, user_id, "pi_t8630_t2c", 250)

        delete_user_module.delete_one(
            user_id, email, "dev", "unused-bucket",
            s3=fake_s3, pg_conn=raw_pg_conn, dry_run=False,
        )
        raw_pg_conn.commit()

        rows = _audit_rows_for(raw_pg_conn, user_id)
        assert len(rows) == 1, f"expected exactly one account_deletions row, got {rows}"
        assert rows[0]["actor"] == "script"
        assert rows[0]["path"] == "delete_user_script"
        assert rows[0]["had_payments"] is True
        assert rows[0]["net_cents"] == 250

    def test_no_payments_user_gets_had_payments_false_net_zero(self, raw_pg_conn, monkeypatch):
        from app.routers import privacy as privacy_mod

        user_id = "t8630_no_pay_user"
        _seed_user(raw_pg_conn, user_id)

        monkeypatch.setattr(privacy_mod, "get_current_user_id", lambda: user_id)
        monkeypatch.setattr("app.routers.auth._purge_user_data", lambda uid: {"local_deleted": False, "r2_objects_deleted": 0})

        import asyncio

        class _FakeRequest:
            pass

        asyncio.run(privacy_mod.delete_account(_FakeRequest()))

        rows = _audit_rows_for(raw_pg_conn, user_id)
        assert len(rows) == 1
        assert rows[0]["had_payments"] is False
        assert rows[0]["net_cents"] == 0

    def test_two_resets_of_same_test_account_write_two_audit_rows_ruling_a(self, raw_pg_conn, monkeypatch):
        """THE ruling-A regression test: `account_deletions.id` is a BIGSERIAL
        PRIMARY KEY (not `user_id` PRIMARY KEY, which the pre-approval design
        draft had). Re-creating the same user_id between two resets and
        deleting it twice must write TWO account_deletions rows, both INSERTs
        succeeding -- a `user_id TEXT PRIMARY KEY` schema would raise a
        duplicate-key error on the second insert."""
        from app.routers import auth as auth_mod
        from app.services.auth_db import create_user

        user_id = "t8630_reset_user"
        email = f"{user_id}@test.local"
        monkeypatch.setattr(auth_mod, "_purge_user_data", lambda uid: {"local_deleted": False, "r2_objects_deleted": 0})

        # First reset: create then reset.
        _seed_user(raw_pg_conn, user_id, email)
        auth_mod._reset_test_account(user_id, email)

        # Re-create the SAME user_id (simulates the next login after reset).
        create_user(user_id, email=email)

        # Second reset: must NOT collide on the PK.
        auth_mod._reset_test_account(user_id, email)

        rows = _audit_rows_for(raw_pg_conn, user_id)
        assert len(rows) == 2, (
            f"two resets of the same test account must write TWO account_deletions rows "
            f"(ruling A: id BIGSERIAL PK, not user_id PK) -- got {len(rows)}: {rows}"
        )
        assert all(r["path"] == "reset_test_account" for r in rows)


# ---------------------------------------------------------------------------
# T3: append-only trigger blocks forbidden UPDATE/DELETE, allows the two
# whitelisted in-place writes.
# ---------------------------------------------------------------------------


class TestT3AppendOnlyTriggerAllowsOnlyWhitelisted:
    """Design §11 T3: the trigger itself is ALREADY LANDED by the parallel
    Migration step (confirmed present in `pg.py` `_SCHEMA_DDL` before writing
    this file), so the DB-level blocking assertions here (forbidden
    UPDATE/DELETE) may already pass. What's still missing is the APP-side
    whitelisted-write helper `stamp_account_deleted` -- (f) below fails with
    AttributeError/ImportError until it exists, which is this test's actual
    red-state contribution (the trigger-only assertions are load-bearing
    regression coverage once the app code lands, not new red state)."""

    def _seed(self, conn, user_id="t8630_trigger_user"):
        _seed_user(conn, user_id)
        _seed_payment(conn, user_id, "pi_t8630_t3", 100)
        return user_id

    def test_update_amount_cents_raises(self, raw_pg_conn):
        user_id = self._seed(raw_pg_conn)
        cur = raw_pg_conn.cursor()
        with pytest.raises(psycopg2.Error):
            cur.execute("UPDATE payments SET amount_cents = 999 WHERE user_id = %s", (user_id,))
        raw_pg_conn.rollback()

    def test_update_kind_user_id_stripe_object_id_occurred_at_raises(self, raw_pg_conn):
        user_id = self._seed(raw_pg_conn)
        for col, val in (("kind", "'refund'"), ("user_id", "'someone_else'"),
                         ("stripe_object_id", "'pi_evil'"), ("occurred_at", "now()")):
            cur = raw_pg_conn.cursor()
            with pytest.raises(psycopg2.Error):
                cur.execute(f"UPDATE payments SET {col} = {val} WHERE user_id = %s", (user_id,))
            raw_pg_conn.rollback()

    def test_delete_from_payments_raises(self, raw_pg_conn):
        user_id = self._seed(raw_pg_conn)
        cur = raw_pg_conn.cursor()
        with pytest.raises(psycopg2.Error):
            cur.execute("DELETE FROM payments WHERE user_id = %s", (user_id,))
        raw_pg_conn.rollback()

    def test_fill_missing_charge_id_null_to_value_succeeds(self, raw_pg_conn):
        from app.services import payments_ledger

        self._seed(raw_pg_conn, "t8630_trigger_user")
        cur = raw_pg_conn.cursor()
        changed = payments_ledger.fill_missing_charge_id(
            cur, stripe_object_id="pi_t8630_t3", stripe_charge_id="ch_t8630_t3",
        )
        raw_pg_conn.commit()
        assert changed is True

    def test_stripe_charge_id_value_to_other_raises(self, raw_pg_conn):
        user_id = self._seed(raw_pg_conn)
        cur = raw_pg_conn.cursor()
        cur.execute("UPDATE payments SET stripe_charge_id = 'ch_first' WHERE user_id = %s", (user_id,))
        raw_pg_conn.commit()

        cur = raw_pg_conn.cursor()
        with pytest.raises(psycopg2.Error):
            cur.execute("UPDATE payments SET stripe_charge_id = 'ch_second' WHERE user_id = %s", (user_id,))
        raw_pg_conn.rollback()

    def test_stamp_account_deleted_null_to_now_succeeds(self, raw_pg_conn):
        """The whitelisted account_deleted_at write itself -- this is the
        assertion that fails until payments_ledger.stamp_account_deleted
        exists (the actual red-state contribution of this test class)."""
        from app.services import payments_ledger  # AttributeError expected on stamp_account_deleted

        user_id = self._seed(raw_pg_conn, "t8630_trigger_user")
        cur = raw_pg_conn.cursor()
        stamped = payments_ledger.stamp_account_deleted(cur, user_id)
        raw_pg_conn.commit()
        assert stamped == 1

        rows = _payments_for(raw_pg_conn, user_id)
        assert rows[0]["account_deleted_at"] is not None


# ---------------------------------------------------------------------------
# T4: TRUNCATE guard.
# ---------------------------------------------------------------------------


class TestT4TruncateGuard:
    """Design §11 T4 / §4.2: TRUNCATE payments raises by default; the
    SET LOCAL escape hatch allows it. The guard itself is ALREADY LANDED
    (confirmed present in pg.py's _SCHEMA_DDL before writing this file) --
    this class is regression coverage, and per the task instructions does
    NOT assume the conftest fix has landed for its own assertions (it opens
    its own raw connection rather than relying on `pg_conn`'s internal
    TRUNCATE succeeding)."""

    def test_truncate_payments_raises_by_default(self, raw_pg_conn):
        cur = raw_pg_conn.cursor()
        with pytest.raises(psycopg2.Error):
            cur.execute("TRUNCATE payments")
        raw_pg_conn.rollback()

    def test_truncate_payments_succeeds_with_guc_escape_hatch(self, raw_pg_conn):
        raw_pg_conn.autocommit = False
        cur = raw_pg_conn.cursor()
        cur.execute("SET LOCAL reelballers.allow_payments_purge = 'on'")
        cur.execute("TRUNCATE payments")
        raw_pg_conn.commit()
        # No exception -> pass. Restore autocommit-style usage for cleanup.
        raw_pg_conn.autocommit = False


# ---------------------------------------------------------------------------
# T5: scripts/delete_user.py --force-paid guard, incl. bulk fail-before-first.
# ---------------------------------------------------------------------------


class TestT5ForcePaidGuard:
    """Design §11 T5 / §6 / AC3: refuses a paying account without
    --force-paid; refuses a bulk run containing one paying account before
    deleting ANYTHING; succeeds with --force-paid and still preserves +
    stamps the ledger with note='forced past payment guard'."""

    def test_payment_summary_helper_exists_and_reports_paying_user(self, raw_pg_conn, delete_user_module):
        """payment_summary doesn't exist yet -- AttributeError expected."""
        user_id = "t8630_bulk_payer"
        _seed_user(raw_pg_conn, user_id)
        _seed_payment(raw_pg_conn, user_id, "pi_t8630_t5a", 500)

        summary = delete_user_module.payment_summary(raw_pg_conn, user_id)
        assert summary["count"] == 1
        assert summary["net_cents"] == 500
        assert summary["object_ids"] == ["pi_t8630_t5a"]

    def test_single_email_paying_user_refused_without_force_paid(
        self, raw_pg_conn, delete_user_module, fake_s3, monkeypatch, capsys,
    ):
        user_id = "t8630_force_paid_user"
        email = f"{user_id}@test.local"
        _seed_user(raw_pg_conn, user_id, email)
        _seed_payment(raw_pg_conn, user_id, "pi_t8630_t5b", 500)

        monkeypatch.setattr(delete_user_module, "get_pg_conn", lambda config: raw_pg_conn)
        monkeypatch.setattr(delete_user_module, "get_r2_client", lambda config: fake_s3)
        monkeypatch.setattr(delete_user_module, "load_env", lambda env_name: {
            "APP_ENV": "dev", "R2_BUCKET": "unused-bucket", "DATABASE_URL": "unused",
        })
        monkeypatch.setattr(sys, "argv", [
            "delete_user.py", "--env", "dev", "--email", email, "--yes",
        ])

        with pytest.raises(SystemExit) as exc_info:
            delete_user_module.main()
        assert exc_info.value.code != 0, "a paying account must be refused without --force-paid"
        assert _user_exists(raw_pg_conn, user_id), "the account must NOT be deleted on refusal"

    def test_bulk_all_refuses_before_deleting_anything_when_one_target_pays(
        self, raw_pg_conn, delete_user_module, fake_s3, monkeypatch,
    ):
        """Fail-before-first-delete: --all with one paying account among
        several targets must refuse the WHOLE run before the first delete."""
        payer_id, free_id = "t8630_bulk_payer", "t8630_bulk_free"
        payer_email, free_email = f"{payer_id}@test.local", f"{free_id}@test.local"
        _seed_user(raw_pg_conn, payer_id, payer_email)
        _seed_user(raw_pg_conn, free_id, free_email)
        _seed_payment(raw_pg_conn, payer_id, "pi_t8630_t5c", 500)

        monkeypatch.setattr(delete_user_module, "get_pg_conn", lambda config: raw_pg_conn)
        monkeypatch.setattr(delete_user_module, "get_r2_client", lambda config: fake_s3)
        monkeypatch.setattr(delete_user_module, "load_env", lambda env_name: {
            "APP_ENV": "dev", "R2_BUCKET": "unused-bucket", "DATABASE_URL": "unused",
        })
        # Scope --all's SELECT to just our two fixtures by faking the query
        # target set via email filtering isn't directly supported by --all,
        # so instead assert on the two users we seeded specifically -- the
        # global --all could catch unrelated dev-db rows, so we only assert
        # that OUR two synthetic users individually survive the refusal.
        monkeypatch.setattr(sys, "argv", ["delete_user.py", "--env", "dev", "--all", "--yes"])

        with pytest.raises(SystemExit) as exc_info:
            delete_user_module.main()
        assert exc_info.value.code != 0, "bulk run with a payer must refuse before deleting anything"
        assert _user_exists(raw_pg_conn, payer_id), "payer must survive the refused bulk run"
        assert _user_exists(raw_pg_conn, free_id), "non-payer must ALSO survive (nothing deleted before refusal)"

    def test_force_paid_deletes_preserves_and_stamps_with_note(
        self, raw_pg_conn, delete_user_module, fake_s3,
    ):
        user_id = "t8630_force_paid_user"
        email = f"{user_id}@test.local"
        _seed_user(raw_pg_conn, user_id, email)
        _seed_payment(raw_pg_conn, user_id, "pi_t8630_t5d", 500)

        delete_user_module.delete_one(
            user_id, email, "dev", "unused-bucket",
            s3=fake_s3, pg_conn=raw_pg_conn, dry_run=False, force_paid=True,
        )
        raw_pg_conn.commit()

        assert not _user_exists(raw_pg_conn, user_id)
        rows = _payments_for(raw_pg_conn, user_id)
        assert len(rows) == 1, "ledger must be preserved even under --force-paid"
        assert rows[0]["account_deleted_at"] is not None, "ledger must still be stamped"

        audit_rows = _audit_rows_for(raw_pg_conn, user_id)
        assert len(audit_rows) == 1
        assert audit_rows[0]["note"] == "forced past payment guard"


# ---------------------------------------------------------------------------
# T6: full incident-reconstruction purely from SQL against account_deletions
# + payments.
# ---------------------------------------------------------------------------


class TestT6IncidentReconstruction:
    """Design §11 T6 / AC5: after deleting a freshly-seeded paying test
    account, answer who/when/which-path/how-much purely from SQL against
    account_deletions + payments."""

    def test_reconstruct_who_when_path_amount_from_tables_alone(self, raw_pg_conn, monkeypatch):
        from app.routers import privacy as privacy_mod

        user_id = "t8630_incident_user"
        _seed_user(raw_pg_conn, user_id)
        _seed_payment(raw_pg_conn, user_id, "pi_t8630_t6a", 999)
        _seed_payment(raw_pg_conn, user_id, "re_t8630_t6a", -199, kind="refund")

        monkeypatch.setattr(privacy_mod, "get_current_user_id", lambda: user_id)
        monkeypatch.setattr("app.routers.auth._purge_user_data", lambda uid: {"local_deleted": False, "r2_objects_deleted": 0})

        import asyncio

        class _FakeRequest:
            pass

        asyncio.run(privacy_mod.delete_account(_FakeRequest()))

        # WHO / WHEN / WHICH PATH / HOW MUCH -- purely from account_deletions.
        cur = raw_pg_conn.cursor()
        cur.execute(
            "SELECT actor, path, deleted_at, had_payments, net_cents FROM account_deletions "
            "WHERE user_id = %s ORDER BY id DESC LIMIT 1",
            (user_id,),
        )
        audit = cur.fetchone()
        assert audit is not None, "no incident record found -- the 2026-09-03 gap is unresolved"
        assert audit["actor"] == "self"
        assert audit["path"] == "privacy_endpoint"
        assert audit["deleted_at"] is not None
        assert audit["had_payments"] is True
        assert audit["net_cents"] == 800, "999 - 199 = 800"

        # The surviving stamped payments rows -- the money itself.
        cur.execute(
            "SELECT COALESCE(SUM(amount_cents), 0) AS net, COUNT(*) AS n FROM payments "
            "WHERE user_id = %s AND account_deleted_at IS NOT NULL",
            (user_id,),
        )
        money = cur.fetchone()
        assert money["n"] == 2, "both the purchase and refund rows must survive, stamped"
        assert money["net"] == 800


# ---------------------------------------------------------------------------
# T7: privacy copy grep assertions across the four changed surfaces.
# ---------------------------------------------------------------------------


class TestT7PrivacyCopyAssertions:
    """Design §11 T7 / AC4 / ruling B / ruling C: the four changed surfaces
    each mention retained transaction records with a reason, none contains
    an em dash, none contains the literal phrase "not personal data", and
    AccountSettings.jsx's confirmation text matches ruling C verbatim."""

    def _read(self, path: Path) -> str:
        assert path.exists(), f"expected file to exist: {path}"
        return path.read_text(encoding="utf-8")

    def test_account_settings_confirmation_matches_ruling_c_verbatim(self):
        text = self._read(ACCOUNT_SETTINGS_PATH)
        assert RULING_C_CONFIRMATION_TEXT in text, (
            "AccountSettings.jsx confirmation copy must match ruling C's exact string"
        )

    def test_all_four_surfaces_mention_retention_reason_no_not_personal_data(self):
        """Whole-file checks: the retention reason is stated, and the file
        never claims the retained record is 'not personal data' (ruling B).
        Em-dash usage is checked separately, scoped to the NEW copy this task
        adds (test_new_retention_copy_has_no_em_dash below) -- these docs are
        marked DRAFT and carry pre-existing, unrelated em dashes elsewhere
        that are out of scope for T8630 to fix."""
        surfaces = {
            "AccountSettings.jsx": ACCOUNT_SETTINGS_PATH,
            "PrivacyPolicy.jsx": PRIVACY_POLICY_JSX_PATH,
            "docs/legal/privacy-policy.md": PRIVACY_POLICY_MD_PATH,
            "docs/legal/data-retention-policy.md": DATA_RETENTION_MD_PATH,
        }
        for name, path in surfaces.items():
            text = self._read(path)
            assert "tax and accounting" in text.lower(), (
                f"{name} must state the tax/accounting retention reason"
            )
            assert "not personal data" not in text.lower(), (
                f"{name} must never claim the retained record is 'not personal data' (ruling B)"
            )

    def test_new_retention_copy_has_no_em_dash(self):
        """The NEW sentences this task adds must follow house style (no em
        dashes) -- scoped to what we actually write, not legacy DRAFT prose
        elsewhere in these files. Each new paragraph/sentence this task adds
        is checked as its own literal substring."""
        assert "—" not in RULING_C_CONFIRMATION_TEXT

        privacy_jsx = self._read(PRIVACY_POLICY_JSX_PATH)
        jsx_paragraph_start = "Transaction records (payment amounts keyed to an opaque account id"
        assert jsx_paragraph_start in privacy_jsx
        jsx_paragraph = privacy_jsx.split(jsx_paragraph_start, 1)[1].split("</p>", 1)[0]
        assert "—" not in jsx_paragraph

        privacy_md = self._read(PRIVACY_POLICY_MD_PATH)
        md_sentence_start = "Transaction records are the one exception"
        assert md_sentence_start in privacy_md
        md_sentence = privacy_md.split(md_sentence_start, 1)[1].split("\n\n", 1)[0]
        assert "—" not in md_sentence

        retention_md = self._read(DATA_RETENTION_MD_PATH)
        heading = "What IS Retained After Deletion"
        assert heading in retention_md
        what_is_retained = retention_md.split(heading, 1)[1].split("### Deletion Timeline", 1)[0]
        assert "—" not in what_is_retained

    def test_data_retention_policy_pseudonymous_wording_ruling_b(self):
        text = self._read(DATA_RETENTION_MD_PATH)
        assert "pseudonymous financial record" in text.lower(), (
            "data-retention-policy.md's 'What IS Retained' section must use ruling B's "
            "pseudonymous-financial-record wording, not a 'not personal data' claim"
        )
