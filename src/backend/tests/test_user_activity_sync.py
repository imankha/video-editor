"""Tests for T3080: dual-write of user activity to per-user SQLite."""

import sqlite3
import logging
from pathlib import Path
from unittest.mock import patch, MagicMock
from contextlib import contextmanager

import pytest
from app.analytics import create_user_milestones, record_milestone, update_session
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


class TestRecordMilestoneDualWrite:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_milestones("user-a", "organic", None, "otp")

    def test_record_milestone_dual_writes(self, pg_conn):
        record_milestone("user-a", "game_created")

        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM user_flow_events WHERE user_id = %s AND event = %s",
                ("user-a", "game_created"),
            )
            pg_row = cur.fetchone()
        assert pg_row is not None
        assert pg_row["count"] == 1

        events = _get_sqlite_events("user-a")
        game_event = next((e for e in events if e["event"] == "game_created"), None)
        assert game_event is not None
        assert game_event["count"] == 1

        activity = _get_sqlite_activity("user-a")
        assert activity is not None
        assert activity["last_active_at"] is not None

    def test_record_milestone_increments_sqlite_count(self, pg_conn):
        record_milestone("user-a", "game_created")
        record_milestone("user-a", "game_created")

        events = _get_sqlite_events("user-a")
        game_event = next((e for e in events if e["event"] == "game_created"), None)
        assert game_event["count"] == 2

    def test_export_event_sets_last_export_at(self, pg_conn):
        record_milestone("user-a", "export_completed")

        activity = _get_sqlite_activity("user-a")
        assert activity is not None
        assert activity["last_export_at"] is not None


class TestUpdateSessionSync:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")
        create_user_milestones("user-a", "organic", None, "otp")

    def test_update_session_syncs_to_sqlite(self, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE user_milestones SET last_active_at = now() - INTERVAL '31 minutes' WHERE user_id = %s",
                ("user-a",),
            )

        update_session("user-a")

        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT session_count, pwa_session_count FROM user_milestones WHERE user_id = %s",
                ("user-a",),
            )
            pg_row = cur.fetchone()

        activity = _get_sqlite_activity("user-a")
        assert activity is not None
        assert activity["session_count"] == pg_row["session_count"]


class TestBackfillUserActivity:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")

    def test_backfill_user_activity(self, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO user_milestones (user_id, origin_type, signup_method, session_count, pwa_session_count)
                   VALUES (%s, %s, %s, %s, %s)""",
                ("user-a", "organic", "otp", 5, 2),
            )
            cur.execute(
                """INSERT INTO user_flow_events (user_id, event, count)
                   VALUES (%s, %s, %s)""",
                ("user-a", "game_created", 3),
            )
            cur.execute(
                """INSERT INTO user_flow_events (user_id, event, count)
                   VALUES (%s, %s, %s)""",
                ("user-a", "clip_created", 7),
            )

        from app.services.user_db import backfill_user_activity
        result = backfill_user_activity("user-a")
        assert result is True

        activity = _get_sqlite_activity("user-a")
        assert activity is not None
        assert activity["session_count"] == 5
        assert activity["pwa_session_count"] == 2

        events = _get_sqlite_events("user-a")
        assert len(events) == 2
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
        create_user_milestones("user-a", "organic", None, "otp")

    def test_sqlite_failure_does_not_break_milestone(self, pg_conn, caplog):
        with patch("app.services.user_db.get_user_db_connection", side_effect=Exception("SQLite broken")):
            record_milestone("user-a", "game_created")

        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM user_flow_events WHERE user_id = %s AND event = %s",
                ("user-a", "game_created"),
            )
            pg_row = cur.fetchone()
        assert pg_row is not None
        assert pg_row["count"] == 1


class TestCreateMilestonesInitializesSqlite:
    @pytest.fixture(autouse=True)
    def _setup(self, pg_conn):
        create_user("user-a", email="a@test.com")

    def test_create_milestones_initializes_sqlite(self, pg_conn):
        create_user_milestones("user-a", "organic", None, "otp")

        activity = _get_sqlite_activity("user-a")
        assert activity is not None
        assert activity["session_count"] == 0
