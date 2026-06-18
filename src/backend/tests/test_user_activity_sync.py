"""Tests for dual-write of user activity to per-user SQLite."""

import json
import sqlite3
import logging
from pathlib import Path
from unittest.mock import patch, MagicMock
from contextlib import contextmanager

import pytest
from app.analytics import create_user_segment, record_milestone, update_session
from app.services.auth_db import create_user


@pytest.fixture(autouse=True)
def _clean_sqlite_activity():
    """Clear SQLite activity tables before each test to avoid cross-test bleed."""
    from app.services.user_db import get_user_db_connection
    for uid in ("user-a", "user-b", "target-user"):
        try:
            with get_user_db_connection(uid) as conn:
                conn.execute("DELETE FROM user_activity")
                conn.execute("DELETE FROM user_activity_events")
                conn.execute("DELETE FROM user_action_log")
                conn.commit()
        except Exception:
            pass
    yield


def _get_sqlite_activity(user_id: str) -> dict | None:
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT * FROM user_activity WHERE user_id = ?", (user_id,)
        ).fetchone()
        return dict(row) if row else None


def _get_sqlite_events(user_id: str) -> list[dict]:
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute("SELECT * FROM user_activity_events").fetchall()
        return [dict(r) for r in rows]


def _get_sqlite_action_log(user_id: str, action: str | None = None) -> list[dict]:
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(user_id) as conn:
        if action:
            rows = conn.execute(
                "SELECT * FROM user_action_log WHERE action = ? ORDER BY id", (action,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM user_action_log ORDER BY id").fetchall()
        return [dict(r) for r in rows]


class TestRecordMilestoneDualWrite:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")

    def test_record_milestone_dual_writes(self, pg_conn):
        record_milestone("user-a", "game_created")

        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM user_actions WHERE user_id = %s AND action = %s",
                ("user-a", "game_created"),
            )
            pg_row = cur.fetchone()
        assert pg_row is not None
        assert pg_row["count"] == 1

        entries = _get_sqlite_action_log("user-a", "game_created")
        assert len(entries) == 1
        assert entries[0]["action"] == "game_created"
        assert entries[0]["created_at"] is not None

    def test_record_milestone_appends_action_log_rows(self, pg_conn):
        record_milestone("user-a", "game_created")
        record_milestone("user-a", "game_created")

        entries = _get_sqlite_action_log("user-a", "game_created")
        assert len(entries) == 2

    def test_record_milestone_writes_action_log_with_context(self, pg_conn):
        record_milestone("user-a", "game_created", {"game_id": 1})

        entries = _get_sqlite_action_log("user-a", "game_created")
        assert len(entries) == 1
        assert json.loads(entries[0]["context"]) == {"game_id": 1}
        assert entries[0]["created_at"] is not None

    def test_export_event_writes_to_action_log(self, pg_conn):
        record_milestone("user-a", "export_completed")

        entries = _get_sqlite_action_log("user-a", "export_completed")
        assert len(entries) == 1


class TestUpdateSessionSync:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")

    def test_update_session_writes_action_log(self, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE user_segments SET last_active_at = now() - INTERVAL '31 minutes' WHERE user_id = %s",
                ("user-a",),
            )

        update_session("user-a")

        entries = _get_sqlite_action_log("user-a", "session_started")
        assert len(entries) == 1
        assert json.loads(entries[0]["context"]) == {"is_pwa": False}
        assert entries[0]["created_at"] is not None


class TestImpersonationSuppression:
    """T1515: actions taken while an admin impersonates a user must not be
    attributed to that user's analytics (no PG user_actions, no SQLite
    action_log, no session timing)."""

    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")

    @pytest.fixture
    def _impersonating(self):
        from app.user_context import set_current_impersonator_id
        set_current_impersonator_id("admin-007")
        try:
            yield
        finally:
            set_current_impersonator_id(None)

    def _pg_action_row(self, user_id, action):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM user_actions WHERE user_id = %s AND action = %s",
                (user_id, action),
            )
            return cur.fetchone()

    def test_record_milestone_suppressed_during_impersonation(self, pg_conn, _impersonating):
        record_milestone("user-a", "game_created", {"game_id": 1})

        assert self._pg_action_row("user-a", "game_created") is None
        assert _get_sqlite_action_log("user-a", "game_created") == []

    def test_update_session_suppressed_during_impersonation(self, pg_conn, _impersonating):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE user_segments SET last_active_at = now() - INTERVAL '31 minutes', "
                "current_session_start = NULL WHERE user_id = %s",
                ("user-a",),
            )

        update_session("user-a")

        assert _get_sqlite_action_log("user-a", "session_started") == []
        # session timing untouched: current_session_start stays NULL
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT current_session_start FROM user_segments WHERE user_id = %s",
                ("user-a",),
            )
            assert cur.fetchone()["current_session_start"] is None

    def test_normal_recording_works_after_impersonation_clears(self, pg_conn):
        from app.user_context import set_current_impersonator_id

        set_current_impersonator_id("admin-007")
        record_milestone("user-a", "game_created")
        set_current_impersonator_id(None)

        # After clearing, a real action records normally.
        record_milestone("user-a", "game_created")

        row = self._pg_action_row("user-a", "game_created")
        assert row is not None and row["count"] == 1
        assert len(_get_sqlite_action_log("user-a", "game_created")) == 1


class TestImpersonationSuppressionIntegration:
    """T1515 end-to-end: a real impersonation session created by T1510's
    create_impersonation_session() must surface impersonator_user_id through
    validate_session() (the exact value the middleware feeds the ContextVar),
    and that value must suppress analytics writes."""

    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        # target = the impersonated user; admin = the impersonator. Both are in
        # conftest._TEST_USER_IDS so they're cleaned up; emails avoid the real
        # imankh@gmail.com dev row that breaks test_impersonation's fixture.
        create_user("target-user", email="t1515-target@example.com")
        create_user("other-admin", email="t1515-admin@example.com")
        create_user_segment("target-user", "organic", None, "google")

    def test_real_impersonation_session_suppresses_analytics(self, pg_conn):
        from app.services.auth_db import create_impersonation_session, validate_session
        from app.user_context import set_current_impersonator_id

        sid = create_impersonation_session("target-user", "other-admin")
        session = validate_session(sid)
        # The session carries the impersonator the middleware reads from request.state.
        assert session is not None
        assert session["user_id"] == "target-user"
        assert session.get("impersonator_user_id") == "other-admin"

        # Replicate the middleware wiring (db_sync.py): feed that value to the ContextVar.
        set_current_impersonator_id(session.get("impersonator_user_id"))
        try:
            record_milestone("target-user", "annotation_completed", {"game_id": 1})
            update_session("target-user")
        finally:
            set_current_impersonator_id(None)

        # Nothing recorded for the impersonated user.
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT count(*) AS cnt FROM user_actions WHERE user_id = %s",
                ("target-user",),
            )
            assert cur.fetchone()["cnt"] == 0
        assert _get_sqlite_action_log("target-user") == []


class TestBackfillUserActivity:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")

    def test_backfill_user_activity(self, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO user_segments (user_id, origin, signup_method)
                   VALUES (%s, %s, %s)""",
                ("user-a", "organic", "otp"),
            )
            cur.execute(
                """INSERT INTO user_actions (user_id, action, count)
                   VALUES (%s, %s, %s)""",
                ("user-a", "session_started", 5),
            )
            cur.execute(
                """INSERT INTO user_actions (user_id, action, count)
                   VALUES (%s, %s, %s)""",
                ("user-a", "game_created", 3),
            )
            cur.execute(
                """INSERT INTO user_actions (user_id, action, count)
                   VALUES (%s, %s, %s)""",
                ("user-a", "clip_created", 7),
            )

        from app.services.user_db import backfill_user_activity
        result = backfill_user_activity("user-a")
        assert result is True

        activity = _get_sqlite_activity("user-a")
        assert activity is not None
        assert activity["session_count"] == 5

        events = _get_sqlite_events("user-a")
        assert len(events) >= 2
        game_event = next(e for e in events if e["event"] == "game_created")
        assert game_event["count"] == 3

        result2 = backfill_user_activity("user-a")
        assert result2 is False

    def test_backfill_no_postgres_data(self, pg_conn):
        from app.services.user_db import backfill_user_activity
        result = backfill_user_activity("user-a")
        assert result is False


class TestSqliteFailureIsolation:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_segment("user-a", "organic", None, "otp")

    def test_sqlite_failure_does_not_break_milestone(self, pg_conn, caplog):
        with patch("app.services.user_db.get_user_db_connection", side_effect=Exception("SQLite broken")):
            record_milestone("user-a", "game_created")

        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM user_actions WHERE user_id = %s AND action = %s",
                ("user-a", "game_created"),
            )
            pg_row = cur.fetchone()
        assert pg_row is not None
        assert pg_row["count"] == 1


class TestCreateSegmentDoesNotWriteSqlite:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")

    def test_create_segment_does_not_write_sqlite(self, pg_conn):
        create_user_segment("user-a", "organic", None, "otp")

        activity = _get_sqlite_activity("user-a")
        assert activity is None
        entries = _get_sqlite_action_log("user-a")
        assert len(entries) == 0
