"""T8630 round 2 -- FAILING-first tests for:

1. scripts/delete_user.py running as a REAL subprocess (the crash the in-process
   test masked): with src/backend NOT on sys.path -- the way the documented
   `cd src/backend && python ../../scripts/delete_user.py` invocation actually
   runs a script FILE -- the pre-fix script imported `app` INSIDE delete_one,
   AFTER the irreversible R2/local purge, so a real deletion raised
   `ModuleNotFoundError: No module named 'app'` and left a half-deleted account.
   RED at fe9fc6dc (ModuleNotFoundError), GREEN after the top-level
   sys.path.insert + import + PG-before-storage reorder.

2. scripts/reset-test-user.py and scripts/copy_user_between_envs.py writing an
   `account_deletions` audit row on the users-row deletion they perform (new
   closed-vocabulary paths `reset_test_user_script` / `copy_user_between_envs`);
   copy also stamps `payments.account_deleted_at`, reset does not.

3. `user_usage_daily` on a real deletion. NOTE: round 2 purged it; T8630 round 4
   REVERSED that -- it is now KEPT (de-identified analytics). The test below is
   updated in place to assert the round-4 behavior.

Every pg_conn test runs against the dedicated throwaway DB (t8630_test2); see
the kickoff. The subprocess harness stubs R2 with a no-op fake and points
DATABASE_URL/get_pg_conn at that same DSN -- the same stubbing the in-process
tests use, but in a real child process whose sys.path does NOT contain
src/backend, which is the whole point.
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import psycopg2
import pytest
from psycopg2.extras import RealDictCursor

REPO_ROOT = Path(__file__).resolve().parents[3]
DELETE_USER_SCRIPT = REPO_ROOT / "scripts" / "delete_user.py"
RESET_TEST_USER_SCRIPT = REPO_ROOT / "scripts" / "reset-test-user.py"
COPY_USER_SCRIPT = REPO_ROOT / "scripts" / "copy_user_between_envs.py"

_R2_IDS = (
    "t8630r2_subproc_del", "t8630r2_subproc_pay",
    "t8630r2_reset", "t8630r2_copy_old", "t8630r2_usage",
)


# --------------------------------------------------------------------------
# DB helpers (same shape as test_t8630_deletion_audit.py)
# --------------------------------------------------------------------------


@pytest.fixture
def raw_pg_conn(pg_conn):
    conn = psycopg2.connect(pg_conn, cursor_factory=RealDictCursor)
    _cleanup(conn)
    yield conn
    conn.rollback()
    _cleanup(conn)
    conn.close()


def _cleanup(conn):
    cur = conn.cursor()
    ph = ",".join(["%s"] * len(_R2_IDS))
    # payments has a row-level append-only trigger (no DELETE possible); the
    # base pg_conn fixture TRUNCATEs it with the GUC hatch on every setup, so we
    # never need to (and never can) delete payment rows here.
    cur.execute(f"DELETE FROM account_deletions WHERE user_id IN ({ph})", _R2_IDS)
    cur.execute(f"DELETE FROM user_usage_daily WHERE user_id IN ({ph})", _R2_IDS)
    cur.execute(f"DELETE FROM user_segments WHERE user_id IN ({ph})", _R2_IDS)
    cur.execute(f"DELETE FROM users WHERE user_id IN ({ph})", _R2_IDS)
    conn.commit()


def _seed_user(conn, user_id, email=None):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO users (user_id, email) VALUES (%s, %s) ON CONFLICT (user_id) DO NOTHING",
        (user_id, email or f"{user_id}@test.local"),
    )
    conn.commit()


def _seed_payment(conn, user_id, stripe_object_id, amount_cents, kind="purchase"):
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO payments (user_id, kind, amount_cents, currency, stripe_object_id,
                               stripe_charge_id, pack, credits, occurred_at, source)
        VALUES (%s, %s, %s, 'usd', %s, NULL, 'starter', 40, '2026-09-01T00:00:00Z', 'webhook')
        ON CONFLICT (stripe_object_id, kind) DO NOTHING
        """,
        (user_id, kind, amount_cents, stripe_object_id),
    )
    conn.commit()


def _seed_usage(conn, user_id, day, seconds):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO user_usage_daily (user_id, day, seconds) VALUES (%s, %s, %s) "
        "ON CONFLICT (user_id, day) DO UPDATE SET seconds = EXCLUDED.seconds",
        (user_id, day, seconds),
    )
    conn.commit()


def _user_exists(conn, user_id):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM users WHERE user_id = %s", (user_id,))
    return cur.fetchone()["c"] > 0


def _audit_rows(conn, user_id):
    cur = conn.cursor()
    cur.execute("SELECT * FROM account_deletions WHERE user_id = %s ORDER BY id", (user_id,))
    return cur.fetchall()


def _payments(conn, user_id):
    cur = conn.cursor()
    cur.execute("SELECT * FROM payments WHERE user_id = %s ORDER BY id", (user_id,))
    return cur.fetchall()


def _usage_rows(conn, user_id):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM user_usage_daily WHERE user_id = %s", (user_id,))
    return cur.fetchone()["c"]


def _load_by_path(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# --------------------------------------------------------------------------
# 1. delete_user.py as a REAL subprocess (the sys.path crash).
# --------------------------------------------------------------------------

# Harness run as `python <tmpfile>` -- a script FILE, so sys.path[0] is the
# tmp dir, NOT src/backend and NOT the cwd. `import app` therefore fails unless
# delete_user.py's OWN top-level sys.path.insert runs. It loads the real script
# by path, stubs R2 + get_pg_conn + load_env (as the in-process tests do), sets
# argv, and calls main(). The stubs are plain attribute sets; they never touch
# sys.path, so the import bug is untouched.
_HARNESS = '''
import importlib.util, os, sys
import psycopg2
from psycopg2.extras import RealDictCursor

script_path = os.environ["DU_SCRIPT_PATH"]
dsn = os.environ["DU_DSN"]
argv = os.environ["DU_ARGS"].split("|")

spec = importlib.util.spec_from_file_location("delete_user_subproc", script_path)
mod = importlib.util.module_from_spec(spec)
sys.modules["delete_user_subproc"] = mod
spec.loader.exec_module(mod)

class _FakeS3:
    def get_paginator(self, _n):
        return self
    def paginate(self, **_k):
        return []

mod.load_env = lambda env_name: {
    "APP_ENV": "dev", "R2_BUCKET": "unused", "DATABASE_URL": dsn,
    "R2_ENDPOINT": "x", "R2_ACCESS_KEY_ID": "x", "R2_SECRET_ACCESS_KEY": "x",
}
mod.get_r2_client = lambda config: _FakeS3()
mod.get_pg_conn = lambda config: psycopg2.connect(dsn, cursor_factory=RealDictCursor)

sys.argv = ["delete_user.py"] + argv
mod.main()
'''


def _run_delete_user_subprocess(dsn, args, script_path=DELETE_USER_SCRIPT):
    """Run delete_user.py's main() in a real child process whose sys.path does
    NOT contain src/backend. Returns the CompletedProcess."""
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, dir=tempfile.gettempdir()) as tf:
        tf.write(_HARNESS)
        harness_path = tf.name
    env = dict(os.environ)
    env["PYTHONPATH"] = ""  # ensure src/backend is NOT inherited onto the path
    env["DU_SCRIPT_PATH"] = str(script_path)
    env["DU_DSN"] = dsn
    env["DU_ARGS"] = "|".join(args)
    try:
        return subprocess.run(
            [sys.executable, harness_path],
            cwd=str(REPO_ROOT / "src" / "backend"),  # documented `cd src/backend`
            env=env, capture_output=True, text=True, timeout=120,
        )
    finally:
        Path(harness_path).unlink(missing_ok=True)


class TestDeleteUserSubprocess:
    def test_non_paying_target_deleted_with_audit_row(self, raw_pg_conn, pg_conn):
        """The decisive red-to-green: a REAL non-paying deletion. RED at
        fe9fc6dc with `ModuleNotFoundError: No module named 'app'` (the late
        import fires after storage purge); GREEN once the script sets sys.path
        and imports at module top."""
        user_id = "t8630r2_subproc_del"
        email = f"{user_id}@test.local"
        _seed_user(raw_pg_conn, user_id, email)

        proc = _run_delete_user_subprocess(pg_conn, ["--env", "dev", "--email", email, "--yes"])

        assert "ModuleNotFoundError" not in (proc.stdout + proc.stderr), (
            "delete_user.py still crashes importing `app` when run as a real "
            f"subprocess:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
        )
        assert proc.returncode == 0, (
            f"subprocess failed (rc={proc.returncode}):\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
        )
        assert not _user_exists(raw_pg_conn, user_id), "the users row must be deleted"
        rows = _audit_rows(raw_pg_conn, user_id)
        assert len(rows) == 1, f"expected one account_deletions row, got {rows}"
        assert rows[0]["actor"] == "script"
        assert rows[0]["path"] == "delete_user_script"

    def test_paying_target_refused_without_force_paid(self, raw_pg_conn, pg_conn):
        """A paying target is refused before deletion (the guard runs in main()
        ahead of delete_one, so this path never reaches the buggy import -- it
        passes at both revisions; included per the item-1 spec to prove the
        refusal survives the real-subprocess entry)."""
        user_id = "t8630r2_subproc_pay"
        email = f"{user_id}@test.local"
        _seed_user(raw_pg_conn, user_id, email)
        _seed_payment(raw_pg_conn, user_id, "pi_t8630r2_pay", 700)

        proc = _run_delete_user_subprocess(pg_conn, ["--env", "dev", "--email", email, "--yes"])

        assert proc.returncode != 0, (
            f"a paying account must be refused without --force-paid:\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
        )
        assert _user_exists(raw_pg_conn, user_id), "the paying account must NOT be deleted on refusal"
        assert len(_audit_rows(raw_pg_conn, user_id)) == 0, "no audit row on a refused run"
        # ledger untouched (not stamped) since nothing was deleted
        rows = _payments(raw_pg_conn, user_id)
        assert len(rows) == 1 and rows[0]["account_deleted_at"] is None


# --------------------------------------------------------------------------
# 2. reset-test-user.py audit row (no stamp).
# --------------------------------------------------------------------------


class TestResetTestUserScriptAudit:
    def test_reset_writes_audit_row_actor_script_path_reset_test_user_script_no_stamp(self, raw_pg_conn):
        mod = _load_by_path("reset_test_user_t8630r2", RESET_TEST_USER_SCRIPT)

        user_id = "t8630r2_reset"
        email = f"{user_id}@test.local"
        _seed_user(raw_pg_conn, user_id, email)
        _seed_payment(raw_pg_conn, user_id, "pi_t8630r2_reset", 500)
        _seed_usage(raw_pg_conn, user_id, "2026-09-01", 120)

        mod.reset_user_postgres(raw_pg_conn, user_id, email)
        raw_pg_conn.commit()

        assert not _user_exists(raw_pg_conn, user_id)
        rows = _audit_rows(raw_pg_conn, user_id)
        assert len(rows) == 1, f"expected one audit row, got {rows}"
        assert rows[0]["actor"] == "script"
        assert rows[0]["path"] == "reset_test_user_script"
        assert rows[0]["had_payments"] is True
        assert rows[0]["net_cents"] == 500
        # ruling 1: reset does NOT stamp -- the user re-logs-in immediately.
        pay = _payments(raw_pg_conn, user_id)
        assert len(pay) == 1 and pay[0]["account_deleted_at"] is None, "reset must NOT stamp the ledger"
        # analytics-only usage buckets purged.
        assert _usage_rows(raw_pg_conn, user_id) == 0


# --------------------------------------------------------------------------
# 3. copy_user_between_envs.py destination-user deletion (audit + stamp).
# --------------------------------------------------------------------------


class TestCopyBetweenEnvsAudit:
    def test_delete_destination_user_writes_audit_and_stamps_ledger(self, raw_pg_conn):
        mod = _load_by_path("copy_user_between_envs_t8630r2", COPY_USER_SCRIPT)

        old_id = "t8630r2_copy_old"
        email = f"{old_id}@test.local"
        _seed_user(raw_pg_conn, old_id, email)
        _seed_payment(raw_pg_conn, old_id, "pi_t8630r2_copy", 900)
        _seed_usage(raw_pg_conn, old_id, "2026-09-02", 300)

        cur = raw_pg_conn.cursor()
        mod.delete_destination_user(cur, old_id, email)
        raw_pg_conn.commit()

        assert not _user_exists(raw_pg_conn, old_id)
        rows = _audit_rows(raw_pg_conn, old_id)
        assert len(rows) == 1, f"expected one audit row, got {rows}"
        assert rows[0]["actor"] == "script"
        assert rows[0]["path"] == "copy_user_between_envs"
        assert rows[0]["had_payments"] is True
        assert rows[0]["net_cents"] == 900
        # copy DOES stamp -- the account is really gone on this env.
        pay = _payments(raw_pg_conn, old_id)
        assert len(pay) == 1 and pay[0]["account_deleted_at"] is not None, "copy must stamp the ledger"
        # T8630 round 4 REVERSED round 2 here: user_usage_daily is now KEPT
        # (de-identified analytics) on a real deletion, not purged.
        assert _usage_rows(raw_pg_conn, old_id) == 1, "round 4: usage_daily is KEPT on a real deletion"


# --------------------------------------------------------------------------
# 4. user_usage_daily on a real deletion (privacy endpoint).
#    T8630 round 4 REVERSED round 2: it is now KEPT (de-identified analytics),
#    not purged. Full de-identified-analytics coverage is in test_t8630_round4.py;
#    this test is updated in place so it documents the reversal at the round-2
#    site rather than asserting the old (now wrong) purge behavior.
# --------------------------------------------------------------------------


class TestUsageDailyKeptOnRealDeletion:
    def test_privacy_deletion_keeps_user_usage_daily(self, raw_pg_conn, monkeypatch):
        from app.routers import privacy as privacy_mod

        user_id = "t8630r2_usage"
        _seed_user(raw_pg_conn, user_id)
        _seed_usage(raw_pg_conn, user_id, "2026-09-03", 60)
        _seed_usage(raw_pg_conn, user_id, "2026-09-04", 90)
        assert _usage_rows(raw_pg_conn, user_id) == 2

        monkeypatch.setattr(privacy_mod, "get_current_user_id", lambda: user_id)
        monkeypatch.setattr(
            "app.routers.auth._purge_user_data",
            lambda uid: {"local_deleted": False, "r2_objects_deleted": 0},
        )

        import asyncio

        class _FakeRequest:
            pass

        asyncio.run(privacy_mod.delete_account(_FakeRequest()))

        assert not _user_exists(raw_pg_conn, user_id)
        assert _usage_rows(raw_pg_conn, user_id) == 2, (
            "round 4: user_usage_daily rows are KEPT (de-identified analytics) on a real deletion"
        )
