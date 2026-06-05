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
    for uid in ("user-a", "user-b"):
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
