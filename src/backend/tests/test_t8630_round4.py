"""T8630 round 4 -- FAILING-first tests for the NEW user decision:

A real account deletion KEEPS the user's analytics in de-identified form (under
the SAME opaque user_id) instead of destroying it, so the payments ledger's
channel/cohort revenue still attributes the deleted payer instead of dropping
them. This REVERSES round 2/3's analytics purge for the three REAL deletion
paths (privacy endpoint, delete_user.py, copy_user_between_envs.py). The two
TEST-RESET paths keep purging analytics (the same user_id comes straight back).

For the rows to survive `DELETE FROM users`, v032 drops the analytics->users FKs.

Tests (item 4):
  1. After a real deletion (privacy endpoint AND delete_user.py subprocess) the
     four tables' rows still exist, user_segments identity stripped, kept columns
     unchanged, user_actions/user_usage_daily/referrals untouched.
  2. Cohort/channel revenue attributes the deleted payer's money (SUM
     total_spent_cents grouped by origin still includes it), not dropped.
  3. The admin user list (users-anchored) does not show the deleted user.
  4. A test reset STILL purges analytics.

Every pg_conn test runs against the dedicated throwaway DB (t8630_test4). RED
against 5c1dd967 (round 3 head, which still DELETEs analytics); GREEN after.
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

_MAIN = "t8630r4_user"
_REFERRER = "t8630r4_referrer"
_SUB = "t8630r4_subproc"
_RESET = "t8630r4_reset"
_R4_IDS = (_MAIN, _REFERRER, _SUB, _RESET)
_ORIGIN = "t8630r4_paid_channel"

_STRIPPED_COLS = (
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
    "click_source", "current_session_start",
)
_KEPT_SEGMENT_COLS = (
    "origin", "acquired_at", "referrer_id", "signup_method",
    "total_spent_cents", "total_usage_seconds",
)


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
    ph = ",".join(["%s"] * len(_R4_IDS))
    cur.execute(f"DELETE FROM referrals WHERE referrer_id IN ({ph}) OR referred_id IN ({ph})", _R4_IDS + _R4_IDS)
    cur.execute(f"DELETE FROM user_actions WHERE user_id IN ({ph})", _R4_IDS)
    cur.execute(f"DELETE FROM user_usage_daily WHERE user_id IN ({ph})", _R4_IDS)
    cur.execute(f"DELETE FROM user_segments WHERE user_id IN ({ph})", _R4_IDS)
    cur.execute(f"DELETE FROM account_deletions WHERE user_id IN ({ph})", _R4_IDS)
    cur.execute(f"DELETE FROM users WHERE user_id IN ({ph})", _R4_IDS)
    conn.commit()


def _seed_user(conn, user_id, email=None):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO users (user_id, email) VALUES (%s, %s) ON CONFLICT (user_id) DO NOTHING",
        (user_id, email or f"{user_id}@test.local"),
    )
    conn.commit()


def _seed_segment(conn, user_id, *, origin=_ORIGIN, referrer_id=None, spent=0):
    """Seed a fully-populated user_segments row (identity columns set so the strip
    is observable, kept columns set so their survival is observable)."""
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO user_segments
             (user_id, acquired_at, origin, referrer_id, signup_method,
              total_spent_cents, last_active_at, total_usage_seconds, current_session_start,
              utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_source)
           VALUES (%s, DATE '2026-09-01', %s, %s, 'google',
                   %s, now(), 4242, now(),
                   'secret_src', 'secret_med', 'secret_camp', 'secret_content', 'secret_term', 'secret_click')""",
        (user_id, origin, referrer_id, spent),
    )
    conn.commit()


def _seed_actions(conn, user_id):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO user_actions (user_id, action, platform, count) VALUES (%s, 'export_completed', 'web', 3)",
        (user_id,),
    )
    conn.commit()


def _seed_usage(conn, user_id):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO user_usage_daily (user_id, day, seconds) VALUES (%s, DATE '2026-09-02', 120), (%s, DATE '2026-09-03', 90) "
        "ON CONFLICT (user_id, day) DO NOTHING",
        (user_id, user_id),
    )
    conn.commit()


def _seed_referral(conn, referrer_id, referred_id):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO referrals (referrer_id, referred_id, channel, source_id, inherited_sport) "
        "VALUES (%s, %s, 'invite_link', 'code123', 'basketball') ON CONFLICT (referred_id) DO NOTHING",
        (referrer_id, referred_id),
    )
    conn.commit()


def _seg(conn, user_id):
    cur = conn.cursor()
    cur.execute("SELECT * FROM user_segments WHERE user_id = %s", (user_id,))
    return cur.fetchone()


def _count(conn, table, col, user_id):
    cur = conn.cursor()
    cur.execute(f"SELECT COUNT(*) AS c FROM {table} WHERE {col} = %s", (user_id,))
    return cur.fetchone()["c"]


def _user_exists(conn, user_id):
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) AS c FROM users WHERE user_id = %s", (user_id,))
    return cur.fetchone()["c"] > 0


def _seed_full_analytics(conn, user_id, *, spent):
    _seed_user(conn, _REFERRER)
    _seed_user(conn, user_id)
    _seed_segment(conn, user_id, referrer_id=_REFERRER, spent=spent)
    _seed_actions(conn, user_id)
    _seed_usage(conn, user_id)
    _seed_referral(conn, _REFERRER, user_id)


def _assert_analytics_kept(conn, user_id):
    seg = _seg(conn, user_id)
    assert seg is not None, "user_segments row must SURVIVE deletion (kept, de-identified)"
    for col in _STRIPPED_COLS:
        assert seg[col] is None, f"user_segments.{col} must be stripped to NULL"
    assert seg["origin"] == _ORIGIN, "origin (channel) must be KEPT"
    assert str(seg["acquired_at"]) == "2026-09-01", "acquired_at (cohort) must be KEPT"
    assert seg["referrer_id"] == _REFERRER, "referrer_id (opaque) must be KEPT"
    assert seg["signup_method"] == "google", "signup_method must be KEPT"
    assert seg["total_usage_seconds"] == 4242, "total_usage_seconds must be KEPT"
    assert _count(conn, "user_actions", "user_id", user_id) == 1, "user_actions must be KEPT"
    assert _count(conn, "user_usage_daily", "user_id", user_id) == 2, "user_usage_daily must be KEPT"
    assert _count(conn, "referrals", "referred_id", user_id) == 1, "referrals row must be KEPT"


# ==========================================================================
# 1a + 2. privacy endpoint keeps + de-identifies analytics; revenue attributes
# ==========================================================================


class TestPrivacyKeepsDeidentifiedAnalytics:
    def test_privacy_deletion_keeps_analytics_and_attributes_revenue(self, raw_pg_conn, monkeypatch):
        from app.routers import privacy as privacy_mod

        _seed_full_analytics(raw_pg_conn, _MAIN, spent=500)

        monkeypatch.setattr(privacy_mod, "get_current_user_id", lambda: _MAIN)
        monkeypatch.setattr("app.routers.auth._purge_user_data",
                            lambda uid: {"local_deleted": False, "r2_objects_deleted": 0})

        import asyncio

        class _FakeRequest:
            pass

        asyncio.run(privacy_mod.delete_account(_FakeRequest()))

        assert not _user_exists(raw_pg_conn, _MAIN), "users row must be gone (identity erased)"
        _assert_analytics_kept(raw_pg_conn, _MAIN)
        # The deleted payer's segment (channel + spend) survives so revenue still
        # attributes. The AUTHORITATIVE proof that the money stays attributed in the
        # admin revenue view -- through the REAL /api/admin/analytics endpoints, not
        # a private re-implementation of the aggregate -- lives in
        # tests/test_t8630_round5.py (round 4's private _channel_revenue helper
        # summed total_spent_cents and so never exercised the endpoint's INNER-join
        # bug that round 5 fixes).
        seg = _seg(raw_pg_conn, _MAIN)
        assert seg["total_spent_cents"] == 500, "total_spent_cents cache must be KEPT for attribution"
        assert seg["origin"] == _ORIGIN, "channel (origin) must be KEPT so revenue attributes"


# ==========================================================================
# 3. admin user list (users-anchored) does not show the deleted user
# ==========================================================================


class TestAdminUserListExcludesDeleted:
    def test_users_anchored_list_excludes_deleted_user_despite_kept_segment(self, raw_pg_conn, monkeypatch):
        from app.routers import privacy as privacy_mod

        _seed_full_analytics(raw_pg_conn, _MAIN, spent=100)
        monkeypatch.setattr(privacy_mod, "get_current_user_id", lambda: _MAIN)
        monkeypatch.setattr("app.routers.auth._purge_user_data",
                            lambda uid: {"local_deleted": False, "r2_objects_deleted": 0})

        import asyncio

        class _FakeRequest:
            pass

        asyncio.run(privacy_mod.delete_account(_FakeRequest()))

        # Admin user list is anchored on `users u LEFT JOIN user_segments s`
        # (admin.py). A retained segment row must NOT resurrect the user there.
        cur = raw_pg_conn.cursor()
        cur.execute(
            "SELECT u.user_id FROM users u LEFT JOIN user_segments s ON u.user_id = s.user_id "
            "WHERE u.user_id = %s",
            (_MAIN,),
        )
        assert cur.fetchone() is None, "deleted user must not appear in the users-anchored admin list"
        assert _seg(raw_pg_conn, _MAIN) is not None, "but its de-identified segment row still exists"


# ==========================================================================
# 4. test reset STILL purges analytics
# ==========================================================================


class TestResetStillPurgesAnalytics:
    def test_reset_test_account_purges_analytics(self, raw_pg_conn, monkeypatch):
        from app.routers import auth as auth_mod

        _seed_full_analytics(raw_pg_conn, _MAIN, spent=0)
        monkeypatch.setattr(auth_mod, "_purge_user_data",
                            lambda uid: {"local_deleted": False, "r2_objects_deleted": 0})
        auth_mod._reset_test_account(_MAIN, f"{_MAIN}@test.local")

        assert _seg(raw_pg_conn, _MAIN) is None, "a test reset must still DELETE user_segments"
        assert _count(raw_pg_conn, "user_actions", "user_id", _MAIN) == 0, "reset must delete user_actions"
        assert _count(raw_pg_conn, "user_usage_daily", "user_id", _MAIN) == 0, "reset must delete user_usage_daily"

    def test_reset_test_user_script_purges_analytics(self, raw_pg_conn):
        spec = importlib.util.spec_from_file_location("reset_test_user_t8630r4", RESET_TEST_USER_SCRIPT)
        mod = importlib.util.module_from_spec(spec)
        sys.modules["reset_test_user_t8630r4"] = mod
        spec.loader.exec_module(mod)

        _seed_full_analytics(raw_pg_conn, _MAIN, spent=0)
        mod.reset_user_postgres(raw_pg_conn, _MAIN, f"{_MAIN}@test.local")
        raw_pg_conn.commit()

        assert _seg(raw_pg_conn, _MAIN) is None, "reset-test-user.py must still DELETE user_segments"
        assert _count(raw_pg_conn, "user_actions", "user_id", _MAIN) == 0


# ==========================================================================
# 1b. delete_user.py subprocess keeps + de-identifies analytics
# ==========================================================================

_HARNESS = '''
import importlib.util, os, sys
import psycopg2
from psycopg2.extras import RealDictCursor

script_path = os.environ["DU_SCRIPT_PATH"]
dsn = os.environ["DU_DSN"]
argv = os.environ["DU_ARGS"].split("|")

spec = importlib.util.spec_from_file_location("delete_user_r4_subproc", script_path)
mod = importlib.util.module_from_spec(spec)
sys.modules["delete_user_r4_subproc"] = mod
spec.loader.exec_module(mod)

class _FakeS3:
    def get_paginator(self, _n):
        return self
    def paginate(self, **_k):
        return []
    def delete_object(self, **_k):
        pass

mod.load_env = lambda env_name: {
    "APP_ENV": "dev", "R2_BUCKET": "unused", "DATABASE_URL": dsn,
    "R2_ENDPOINT": "x", "R2_ACCESS_KEY_ID": "x", "R2_SECRET_ACCESS_KEY": "x",
}
mod.get_r2_client = lambda config: _FakeS3()
mod.get_pg_conn = lambda config: psycopg2.connect(dsn, cursor_factory=RealDictCursor)

sys.argv = ["delete_user.py"] + argv
mod.main()
'''


def _run_delete_user_subprocess(dsn, args):
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False, dir=tempfile.gettempdir()) as tf:
        tf.write(_HARNESS)
        harness_path = tf.name
    env = dict(os.environ)
    env["PYTHONPATH"] = ""
    env["DU_SCRIPT_PATH"] = str(DELETE_USER_SCRIPT)
    env["DU_DSN"] = dsn
    env["DU_ARGS"] = "|".join(args)
    try:
        return subprocess.run(
            [sys.executable, harness_path],
            cwd=str(REPO_ROOT / "src" / "backend"),
            env=env, capture_output=True, text=True, timeout=180,
        )
    finally:
        Path(harness_path).unlink(missing_ok=True)


class TestV032DropsRenamedUserActionsFk:
    """Rename-aware proof for v032 (reviewer BLOCKING finding): on a real upgraded
    DB, user_actions' FK is named `user_flow_events_user_id_fkey` (v007 created the
    table as user_flow_events, v009 renamed the table but Postgres keeps the FK's
    original name). A hardcoded `DROP CONSTRAINT IF EXISTS user_actions_user_id_fkey`
    would silently no-op and leave the FK, breaking every real deletion in prod.
    This reconstructs that history in a scratch DB and asserts v032 drops the FK by
    its ACTUAL name, so `DELETE FROM users` with a surviving user_actions row works.
    """

    def test_v032_drops_fk_regardless_of_renamed_constraint_name(self):
        from app.migrations.postgres.v032_analytics_survive_deletion import (
            V032AnalyticsSurviveDeletion,
        )

        base = os.environ["DATABASE_URL"]
        head, _ = base.rsplit("/", 1)
        admin = psycopg2.connect(f"{head}/postgres")
        admin.autocommit = True
        acur = admin.cursor()
        acur.execute("DROP DATABASE IF EXISTS t8630_test4_fk WITH (FORCE)")
        acur.execute("CREATE DATABASE t8630_test4_fk")
        admin.close()

        conn = psycopg2.connect(f"{head}/t8630_test4_fk", cursor_factory=RealDictCursor)
        try:
            conn.autocommit = True
            cur = conn.cursor()
            cur.execute("CREATE TABLE users (user_id TEXT PRIMARY KEY)")
            # Reproduce the v007-create + v009-rename history exactly: the FK is
            # auto-named user_flow_events_user_id_fkey and SURVIVES the rename.
            cur.execute("CREATE TABLE user_flow_events (user_id TEXT NOT NULL REFERENCES users(user_id), action TEXT)")
            cur.execute("ALTER TABLE user_flow_events RENAME TO user_actions")
            cur.execute("""SELECT conname FROM pg_constraint
                           WHERE contype='f' AND conrelid='user_actions'::regclass AND confrelid='users'::regclass""")
            assert cur.fetchone()["conname"] == "user_flow_events_user_id_fkey", (
                "precondition: the renamed FK must keep its original name (the prod hazard)"
            )

            V032AnalyticsSurviveDeletion().up(conn)

            cur.execute("""SELECT count(*) AS c FROM pg_constraint
                           WHERE contype='f' AND conrelid='user_actions'::regclass AND confrelid='users'::regclass""")
            assert cur.fetchone()["c"] == 0, "v032 must drop the renamed FK by its actual name"

            # The decisive behavior: a user with a surviving analytics row can now be deleted.
            cur.execute("INSERT INTO users (user_id) VALUES ('u1')")
            cur.execute("INSERT INTO user_actions (user_id, action) VALUES ('u1', 'export_completed')")
            cur.execute("DELETE FROM users WHERE user_id = 'u1'")  # must NOT raise an FK violation
            cur.execute("SELECT count(*) AS c FROM user_actions WHERE user_id = 'u1'")
            assert cur.fetchone()["c"] == 1, "the analytics row survives the users-row deletion"
        finally:
            conn.close()
            admin = psycopg2.connect(f"{head}/postgres")
            admin.autocommit = True
            admin.cursor().execute("DROP DATABASE IF EXISTS t8630_test4_fk WITH (FORCE)")
            admin.close()


class TestDeleteUserScriptKeepsAnalytics:
    def test_subprocess_deletion_keeps_deidentified_analytics(self, raw_pg_conn, pg_conn):
        # A non-paying target under a distinct referrer, referred by that referrer.
        _seed_user(raw_pg_conn, _REFERRER)
        _seed_user(raw_pg_conn, _SUB)
        _seed_segment(raw_pg_conn, _SUB, referrer_id=_REFERRER, spent=0)
        _seed_actions(raw_pg_conn, _SUB)
        _seed_usage(raw_pg_conn, _SUB)
        _seed_referral(raw_pg_conn, _REFERRER, _SUB)

        proc = _run_delete_user_subprocess(pg_conn, ["--env", "dev", "--email", f"{_SUB}@test.local", "--yes"])
        assert proc.returncode == 0, f"subprocess failed:\n{proc.stdout}\n{proc.stderr}"
        assert not _user_exists(raw_pg_conn, _SUB), "users row must be deleted"

        seg = _seg(raw_pg_conn, _SUB)
        assert seg is not None, "user_segments row must survive the script deletion"
        for col in _STRIPPED_COLS:
            assert seg[col] is None, f"{col} must be stripped"
        assert seg["origin"] == _ORIGIN and seg["referrer_id"] == _REFERRER
        assert _count(raw_pg_conn, "user_actions", "user_id", _SUB) == 1
        assert _count(raw_pg_conn, "user_usage_daily", "user_id", _SUB) == 2
        assert _count(raw_pg_conn, "referrals", "referred_id", _SUB) == 1
