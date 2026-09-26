"""T8630 round 3 -- FAILING-first tests for:

1. scripts/delete_user.py bulk half-delete: main() used to commit ONCE after the
   whole loop, so a later target failing in Postgres rolled back every earlier
   target's DELETE -- AFTER that earlier target's irreversible storage purge had
   already run -- leaving half-deleted accounts (storage gone, users row alive,
   no audit). Fix: commit each user's Postgres work in its own transaction
   BEFORE its storage purge. RED at e15a9ce8 (the earlier target is left with its
   row alive after the run), GREEN after.

2. bug_reports anonymization on a real deletion: the report TEXT is kept (to fix
   problems) but every identifying/device/attachment column is cleared and the R2
   screenshot/console-log objects are deleted. Applies to the privacy endpoint,
   delete_user.py and copy_user_between_envs.py; NOT the two NUF test-reset paths.
   Also: otp_codes rows purged, share_claims rows (opaque claimer_user_id, NOT
   NULL -> deleted) purged.

Every pg_conn test runs against the dedicated throwaway DB (t8630_test3); see the
kickoff. The bulk subprocess test manages its OWN throwaway DB (t8630_test3_bulk)
so `--all` sees exactly its three seeded targets and nothing else.
"""

from __future__ import annotations

import importlib.util
import json
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
COPY_USER_SCRIPT = REPO_ROOT / "scripts" / "copy_user_between_envs.py"
RESET_TEST_USER_SCRIPT = REPO_ROOT / "scripts" / "reset-test-user.py"

_BUG_MARKER = "T8630R3-BUG"
_R3_IDS = (
    "t8630r3_privacy", "t8630r3_du_script", "t8630r3_copy_old",
    "t8630r3_reset", "t8630r3_sharer",
)
_R3_EMAILS = tuple(f"{u}@test.local" for u in _R3_IDS)


# --------------------------------------------------------------------------
# In-process fixtures (share the pg_conn throwaway DB)
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
    ph = ",".join(["%s"] * len(_R3_IDS))
    eph = ",".join(["%s"] * len(_R3_EMAILS))
    # bug_reports is NOT in conftest's TRUNCATE list and its email is nulled on
    # anonymization, so clean by our unique description marker (kept intact) as
    # well as by email for un-anonymized rows.
    cur.execute("DELETE FROM bug_reports WHERE description LIKE %s", (_BUG_MARKER + "%",))
    cur.execute(f"DELETE FROM share_claims WHERE claimer_user_id IN ({ph})", _R3_IDS)
    cur.execute(f"DELETE FROM shares WHERE sharer_user_id IN ({ph})", _R3_IDS)
    cur.execute(f"DELETE FROM otp_codes WHERE email IN ({eph})", _R3_EMAILS)
    cur.execute(f"DELETE FROM account_deletions WHERE user_id IN ({ph})", _R3_IDS)
    cur.execute(f"DELETE FROM user_usage_daily WHERE user_id IN ({ph})", _R3_IDS)
    cur.execute(f"DELETE FROM user_segments WHERE user_id IN ({ph})", _R3_IDS)
    cur.execute(f"DELETE FROM users WHERE user_id IN ({ph})", _R3_IDS)
    conn.commit()


def _seed_user(conn, user_id, email=None):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO users (user_id, email) VALUES (%s, %s) ON CONFLICT (user_id) DO NOTHING",
        (user_id, email or f"{user_id}@test.local"),
    )
    conn.commit()


def _seed_bug(conn, email, screenshot_key=None, logs_key=None):
    """Insert one bug_reports row with identifying/device/attachment columns
    populated. Returns its id."""
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO bug_reports
            (reporter_email, description, page_url, user_agent, build,
             editor_context, actions, console_logs, screenshot_r2_key, logs_r2_key)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s)
        RETURNING id
        """,
        (
            email, f"{_BUG_MARKER}: video export failed", "https://app/editor/proj-123",
            "Mozilla/5.0 (secret device)", "build-2026-09-25",
            json.dumps({"project": "My Kid's Game"}), json.dumps([{"a": "click"}]),
            json.dumps(["console error: token=abc"]), screenshot_key, logs_key,
        ),
    )
    bug_id = cur.fetchone()["id"]
    conn.commit()
    return bug_id


def _bug_row(conn, bug_id):
    cur = conn.cursor()
    cur.execute("SELECT * FROM bug_reports WHERE id = %s", (bug_id,))
    return cur.fetchone()


def _seed_otp(conn, email):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO otp_codes (email, code, expires_at) VALUES (%s, %s, now() + interval '10 min')",
        (email, "123456"),
    )
    conn.commit()


def _otp_count(conn, email):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM otp_codes WHERE email = %s", (email,))
    return cur.fetchone()["c"]


def _seed_share_claim(conn, sharer_id, claimer_id):
    """Seed a share owned by `sharer_id` and a claim on it by `claimer_id`.
    claimer_user_id is plain TEXT (no FK), so `claimer_id` need not be a real
    user; the share's sharer_user_id DOES FK to users, so seed the sharer."""
    _seed_user(conn, sharer_id)
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO shares (share_token, share_type, sharer_user_id, sharer_profile_id, recipient_email)
           VALUES (%s, 'video', %s, 'prof-1', 'recip@test.local') RETURNING id""",
        (f"tok-{claimer_id}", sharer_id),
    )
    share_id = cur.fetchone()["id"]
    cur.execute(
        "INSERT INTO share_claims (share_id, claimer_user_id) VALUES (%s, %s)",
        (share_id, claimer_id),
    )
    conn.commit()


def _share_claim_count(conn, claimer_id):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM share_claims WHERE claimer_user_id = %s", (claimer_id,))
    return cur.fetchone()["c"]


def _user_exists(conn, user_id):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM users WHERE user_id = %s", (user_id,))
    return cur.fetchone()["c"] > 0


def _load_by_path(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class _RecordingS3:
    """No-op paginator (nothing under the user prefix) that RECORDS delete_object
    calls -- the bug-report attachment purge uses delete_object with the stored
    global key."""

    def __init__(self):
        self.deleted_objects: list[str] = []

    def get_paginator(self, _n):
        return self

    def paginate(self, **_k):
        return []

    def delete_object(self, Bucket, Key):
        self.deleted_objects.append(Key)

    def delete_objects(self, Bucket, Delete):
        self.deleted_objects.extend(o["Key"] for o in Delete["Objects"])


# ==========================================================================
# 2. bug_reports anonymization (+ otp_codes + share_claims) on real deletions
# ==========================================================================

_CLEARED_COLS = (
    "reporter_email", "page_url", "user_agent", "editor_context",
    "actions", "console_logs", "screenshot_r2_key", "logs_r2_key",
)


class TestPrivacyEndpointAnonymizesBugReports:
    def test_privacy_deletion_keeps_text_clears_pii_deletes_attachments(self, raw_pg_conn, monkeypatch):
        from app.routers import privacy as privacy_mod

        user_id = "t8630r3_privacy"
        email = f"{user_id}@test.local"
        _seed_user(raw_pg_conn, user_id, email)
        bug_id = _seed_bug(raw_pg_conn, email,
                           screenshot_key="dev/bugs/900/screenshot.jpg",
                           logs_key="dev/bugs/900/console-logs.txt")
        _seed_otp(raw_pg_conn, email)
        _seed_share_claim(raw_pg_conn, "t8630r3_sharer", user_id)

        deleted_r2: list[str] = []
        monkeypatch.setattr(privacy_mod, "get_current_user_id", lambda: user_id)
        monkeypatch.setattr("app.routers.auth._purge_user_data",
                            lambda uid: {"local_deleted": False, "r2_objects_deleted": 0})
        monkeypatch.setattr("app.storage.r2_delete_object_global",
                            lambda key: deleted_r2.append(key) or True)

        import asyncio

        class _FakeRequest:
            pass

        asyncio.run(privacy_mod.delete_account(_FakeRequest()))

        assert not _user_exists(raw_pg_conn, user_id)
        row = _bug_row(raw_pg_conn, bug_id)
        assert row is not None, "the bug report row must SURVIVE (anonymized, not deleted)"
        assert row["description"] == f"{_BUG_MARKER}: video export failed", "the report TEXT must be kept"
        assert row["build"] == "build-2026-09-25", "the app build string is kept (not a device id)"
        for col in _CLEARED_COLS:
            assert row[col] is None, f"{col} must be cleared on anonymization"
        assert set(deleted_r2) == {"dev/bugs/900/screenshot.jpg", "dev/bugs/900/console-logs.txt"}, (
            f"both R2 attachments must be deleted, got {deleted_r2}"
        )
        assert _otp_count(raw_pg_conn, email) == 0, "otp_codes must be purged"
        assert _share_claim_count(raw_pg_conn, user_id) == 0, "share_claims must be purged"


class TestDeleteUserScriptAnonymizesBugReports:
    def test_delete_one_keeps_text_clears_pii_deletes_attachments(self, raw_pg_conn):
        mod = _load_by_path("delete_user_t8630r3", DELETE_USER_SCRIPT)

        user_id = "t8630r3_du_script"
        email = f"{user_id}@test.local"
        _seed_user(raw_pg_conn, user_id, email)
        bug_id = _seed_bug(raw_pg_conn, email,
                           screenshot_key="dev/bugs/901/screenshot.jpg",
                           logs_key="dev/bugs/901/console-logs.txt")
        _seed_otp(raw_pg_conn, email)
        _seed_share_claim(raw_pg_conn, "t8630r3_sharer", user_id)

        s3 = _RecordingS3()
        mod.delete_one(user_id, email, "dev", "unused-bucket",
                       s3=s3, pg_conn=raw_pg_conn, dry_run=False)
        raw_pg_conn.commit()

        assert not _user_exists(raw_pg_conn, user_id)
        row = _bug_row(raw_pg_conn, bug_id)
        assert row is not None and row["description"] == f"{_BUG_MARKER}: video export failed"
        for col in _CLEARED_COLS:
            assert row[col] is None, f"{col} must be cleared"
        assert set(s3.deleted_objects) >= {"dev/bugs/901/screenshot.jpg", "dev/bugs/901/console-logs.txt"}, (
            f"both bug attachments must be deleted via s3.delete_object, got {s3.deleted_objects}"
        )
        assert _otp_count(raw_pg_conn, email) == 0
        assert _share_claim_count(raw_pg_conn, user_id) == 0


class TestCopyBetweenEnvsAnonymizesBugReports:
    def test_delete_destination_user_clears_pii_and_returns_attachment_keys(self, raw_pg_conn):
        mod = _load_by_path("copy_user_t8630r3", COPY_USER_SCRIPT)

        old_id = "t8630r3_copy_old"
        email = f"{old_id}@test.local"
        _seed_user(raw_pg_conn, old_id, email)
        bug_id = _seed_bug(raw_pg_conn, email,
                           screenshot_key="prod/bugs/902/screenshot.jpg",
                           logs_key="prod/bugs/902/console-logs.txt")
        _seed_share_claim(raw_pg_conn, "t8630r3_sharer", old_id)

        cur = raw_pg_conn.cursor()
        returned_keys = mod.delete_destination_user(cur, old_id, email)
        raw_pg_conn.commit()

        assert not _user_exists(raw_pg_conn, old_id)
        row = _bug_row(raw_pg_conn, bug_id)
        assert row is not None and row["description"] == f"{_BUG_MARKER}: video export failed"
        for col in _CLEARED_COLS:
            assert row[col] is None, f"{col} must be cleared"
        assert set(returned_keys) == {"prod/bugs/902/screenshot.jpg", "prod/bugs/902/console-logs.txt"}, (
            f"delete_destination_user must return the attachment keys to purge post-commit, got {returned_keys}"
        )
        assert _share_claim_count(raw_pg_conn, old_id) == 0


class TestResetPathsDoNotAnonymizeBugReports:
    """Scope decision (stated in the task file): the two NUF test-reset paths do
    NOT anonymize bug_reports -- the same email logs straight back in and its own
    historical reports should stay intact."""

    def test_reset_test_account_leaves_bug_reports_untouched(self, raw_pg_conn, monkeypatch):
        from app.routers import auth as auth_mod

        user_id = "t8630r3_reset"
        email = f"{user_id}@test.local"
        _seed_user(raw_pg_conn, user_id, email)
        bug_id = _seed_bug(raw_pg_conn, email, screenshot_key="dev/bugs/903/screenshot.jpg")

        monkeypatch.setattr(auth_mod, "_purge_user_data",
                            lambda uid: {"local_deleted": False, "r2_objects_deleted": 0})
        auth_mod._reset_test_account(user_id, email)

        row = _bug_row(raw_pg_conn, bug_id)
        assert row["reporter_email"] == email, "reset must NOT anonymize bug_reports"
        assert row["screenshot_r2_key"] == "dev/bugs/903/screenshot.jpg"

    def test_reset_test_user_script_leaves_bug_reports_untouched(self, raw_pg_conn):
        mod = _load_by_path("reset_test_user_t8630r3", RESET_TEST_USER_SCRIPT)

        user_id = "t8630r3_reset"
        email = f"{user_id}@test.local"
        _seed_user(raw_pg_conn, user_id, email)
        bug_id = _seed_bug(raw_pg_conn, email, screenshot_key="dev/bugs/904/screenshot.jpg")

        mod.reset_user_postgres(raw_pg_conn, user_id, email)
        raw_pg_conn.commit()

        row = _bug_row(raw_pg_conn, bug_id)
        assert row["reporter_email"] == email, "reset-test-user.py must NOT anonymize bug_reports"


# ==========================================================================
# 1. bulk delete_user.py half-delete -- per-user commit before storage purge
# ==========================================================================


def _bulk_dsn():
    base = os.environ["DATABASE_URL"]
    head, _ = base.rsplit("/", 1)
    return f"{head}/t8630_test3_bulk"


def _admin_conn():
    base = os.environ["DATABASE_URL"]
    head, _ = base.rsplit("/", 1)
    conn = psycopg2.connect(f"{head}/postgres")
    conn.autocommit = True
    return conn


# Subprocess harness: run delete_user.py's main() in a child process whose
# sys.path does NOT contain src/backend (the documented `cd src/backend && python
# ../../scripts/delete_user.py` invocation), pointing get_pg_conn at the bulk DB
# and recording every R2 delete to DU_REC.
_HARNESS = '''
import importlib.util, json, os, sys
import psycopg2
from psycopg2.extras import RealDictCursor

script_path = os.environ["DU_SCRIPT_PATH"]
dsn = os.environ["DU_DSN"]
rec_path = os.environ["DU_REC"]
argv = os.environ["DU_ARGS"].split("|")

spec = importlib.util.spec_from_file_location("delete_user_bulk_subproc", script_path)
mod = importlib.util.module_from_spec(spec)
sys.modules["delete_user_bulk_subproc"] = mod
spec.loader.exec_module(mod)

def _rec(entry):
    with open(rec_path, "a") as f:
        f.write(json.dumps(entry) + "\\n")

class _FakeS3:
    def get_paginator(self, _n):
        return self
    def paginate(self, **kw):
        prefix = kw.get("Prefix", "")
        return [{"Contents": [{"Key": prefix + "obj.bin"}]}]
    def delete_objects(self, Bucket, Delete):
        _rec({"op": "delete_objects", "keys": [o["Key"] for o in Delete["Objects"]]})
    def delete_object(self, Bucket, Key):
        _rec({"op": "delete_object", "key": Key})

mod.load_env = lambda env_name: {
    "APP_ENV": "dev", "R2_BUCKET": "unused", "DATABASE_URL": dsn,
    "R2_ENDPOINT": "x", "R2_ACCESS_KEY_ID": "x", "R2_SECRET_ACCESS_KEY": "x",
}
mod.get_r2_client = lambda config: _FakeS3()
mod.get_pg_conn = lambda config: psycopg2.connect(dsn, cursor_factory=RealDictCursor)

sys.argv = ["delete_user.py"] + argv
mod.main()
'''


def _run_bulk_subprocess(dsn, rec_path, args):
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, dir=tempfile.gettempdir()) as tf:
        tf.write(_HARNESS)
        harness_path = tf.name
    env = dict(os.environ)
    env["PYTHONPATH"] = ""  # src/backend must NOT be inherited onto the path
    env["DU_SCRIPT_PATH"] = str(DELETE_USER_SCRIPT)
    env["DU_DSN"] = dsn
    env["DU_REC"] = rec_path
    env["DU_ARGS"] = "|".join(args)
    try:
        return subprocess.run(
            [sys.executable, harness_path],
            cwd=str(REPO_ROOT / "src" / "backend"),
            env=env, capture_output=True, text=True, timeout=180,
        )
    finally:
        Path(harness_path).unlink(missing_ok=True)


class TestBulkDeletePerUserCommit:
    def test_middle_target_pg_failure_does_not_half_delete_earlier_target(self):
        """Three targets A, B, C; B fails in Postgres (an FK row blocks its
        DELETE FROM users). The pre-pass --force-paid check passes, so deletion
        proceeds.

        RED at e15a9ce8: main() commits once after the whole loop, so A's DELETE
        (already storage-purged) is rolled back when B raises -> A's users row is
        left ALIVE with no audit while its storage is gone (half-deleted).

        GREEN after the fix: A commits (and is storage-purged) BEFORE B is
        touched, so A is fully deleted regardless of B; B stays fully intact; C
        (the continue rule) is fully deleted; the run exits non-zero.
        """
        from app.services.pg import _SCHEMA_DDL

        admin = _admin_conn()
        acur = admin.cursor()
        acur.execute("SELECT 1 FROM pg_database WHERE datname = 't8630_test3_bulk'")
        if acur.fetchone():
            acur.execute("DROP DATABASE t8630_test3_bulk")
        acur.execute("CREATE DATABASE t8630_test3_bulk")
        admin.close()

        dsn = _bulk_dsn()
        rec_fd, rec_path = tempfile.mkstemp(suffix=".jsonl")
        os.close(rec_fd)
        conn = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
        try:
            conn.autocommit = True
            cur = conn.cursor()
            cur.execute(_SCHEMA_DDL)

            a, b, c = "t8630r3_bulk_a", "t8630r3_bulk_b", "t8630r3_bulk_c"
            for uid in (a, b, c):  # insertion order == seq-scan order for a fresh heap
                cur.execute("INSERT INTO users (user_id, email) VALUES (%s, %s)",
                            (uid, f"{uid}@test.local"))
            # A is a paying account -> assert its ledger survives + is stamped.
            cur.execute(
                """INSERT INTO payments (user_id, kind, amount_cents, currency, stripe_object_id,
                       stripe_charge_id, pack, credits, occurred_at, source)
                   VALUES (%s, 'purchase', 500, 'usd', 'pi_t8630r3_a', NULL, 'starter', 40,
                           '2026-09-01T00:00:00Z', 'webhook')""",
                (a,),
            )
            # An FK row that blocks B's DELETE FROM users (nothing cleans it).
            cur.execute("CREATE TABLE t8630r3_fkblock (uid TEXT REFERENCES users(user_id))")
            cur.execute("INSERT INTO t8630r3_fkblock (uid) VALUES (%s)", (b,))

            proc = _run_bulk_subprocess(dsn, rec_path, ["--env", "dev", "--all", "--force-paid", "--yes"])

            # A: fully deleted -- the decisive red-to-green assertion.
            cur.execute("SELECT COUNT(*) AS c FROM users WHERE user_id = %s", (a,))
            assert cur.fetchone()["c"] == 0, (
                "target A must be fully deleted, not rolled back by B's later failure "
                f"(half-delete bug).\nrc={proc.returncode}\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
            )
            cur.execute("SELECT COUNT(*) AS c FROM account_deletions WHERE user_id = %s", (a,))
            assert cur.fetchone()["c"] == 1, "A must have its audit row"
            cur.execute("SELECT account_deleted_at FROM payments WHERE user_id = %s", (a,))
            assert cur.fetchone()["account_deleted_at"] is not None, "A's ledger must survive + be stamped"

            # B: fully intact (its own transaction rolled back).
            cur.execute("SELECT COUNT(*) AS c FROM users WHERE user_id = %s", (b,))
            assert cur.fetchone()["c"] == 1, "B (the failing target) must be left fully intact"
            cur.execute("SELECT COUNT(*) AS c FROM account_deletions WHERE user_id = %s", (b,))
            assert cur.fetchone()["c"] == 0, "B must have NO audit row"

            # C: the continue rule -> also fully deleted.
            cur.execute("SELECT COUNT(*) AS c FROM users WHERE user_id = %s", (c,))
            assert cur.fetchone()["c"] == 0, "C must be deleted (continue-past-failure rule)"

            # Non-zero exit because B failed.
            assert proc.returncode != 0, "the run must exit non-zero when a target fails"

            # Storage: A and C purged (committed), B not (never committed).
            with open(rec_path) as f:
                recs = [json.loads(line) for line in f if line.strip()]
            deleted_keys = set()
            for r in recs:
                if r["op"] == "delete_objects":
                    deleted_keys.update(r["keys"])
                elif r["op"] == "delete_object":
                    deleted_keys.add(r["key"])
            assert f"dev/users/{a}/obj.bin" in deleted_keys, "A's storage must be purged"
            assert f"dev/users/{c}/obj.bin" in deleted_keys, "C's storage must be purged"
            assert f"dev/users/{b}/obj.bin" not in deleted_keys, "B's storage must NOT be purged"
        finally:
            conn.close()
            Path(rec_path).unlink(missing_ok=True)
            admin = _admin_conn()
            acur = admin.cursor()
            acur.execute("DROP DATABASE IF EXISTS t8630_test3_bulk WITH (FORCE)")
            admin.close()
