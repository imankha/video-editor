"""Tests for analytics dashboard endpoints and daily_counters."""

from datetime import date, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import create_user_segment, record_milestone


from app.services.auth_db import create_user


@pytest.fixture()
def analytics_setup(pg_conn):
    create_user("admin-user", email="test-admin@test.local")
    create_user("user-a", email="a@test.com")
    create_user("user-b", email="b@test.com")

    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )

    create_user_segment("user-a", "organic", None, "otp")
    create_user_segment("user-b", "organic", "user-a", "google")

    record_milestone("user-a", "game_created")
    record_milestone("user-a", "clip_created")
    record_milestone("user-a", "export_completed")
    record_milestone("user-b", "game_created")
    yield


@pytest.fixture()
def analytics_with_journey(analytics_setup, pg_conn):
    record_milestone("user-a", "share_completed")
    record_milestone("user-a", "share_completed")
    yield


@pytest.fixture()
def client(analytics_setup, tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def client_journey(analytics_with_journey, tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


def _auth(user_id="admin-user"):
    return {"X-User-ID": user_id}


class TestDailyCounters:
    def test_create_segment_increments_signups(self, pg_conn):
        create_user("test-user", email="test@test.com")
        create_user_segment("test-user", "organic", None, "otp")

        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT signups FROM daily_counters WHERE counter_date = CURRENT_DATE AND origin_type = 'organic'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["signups"] >= 1

            cur.execute(
                "SELECT signups FROM daily_counters WHERE counter_date = CURRENT_DATE AND origin_type = 'all'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["signups"] >= 1

    def test_record_milestone_increments_counter(self, analytics_setup, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT games_created FROM daily_counters WHERE counter_date = CURRENT_DATE AND origin_type = 'all'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["games_created"] >= 2

    def test_pwa_installed_has_no_counter(self, analytics_setup, pg_conn):
        record_milestone("user-a", "pwa_installed")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM daily_counters WHERE counter_date = CURRENT_DATE AND origin_type = 'all'")
            row = cur.fetchone()
            assert "pwa_installed" not in (row or {})


class TestFunnelEndpoint:
    def test_non_admin_403(self, client):
        resp = client.get("/api/admin/analytics/funnel", headers=_auth("user-a"))
        assert resp.status_code == 403

    def test_returns_funnel_shape(self, client):
        resp = client.get("/api/admin/analytics/funnel", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert "funnel" in data
        assert "from" in data
        assert "to" in data
        assert len(data["funnel"]) >= 1
        totals = data["funnel"][0]
        assert totals["origin"] == "all"
        assert totals["signed_up"] >= 2

    def test_origin_filter(self, client):
        resp = client.get("/api/admin/analytics/funnel?origin=organic", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        for row in data["funnel"]:
            assert row["origin"] == "organic"

    def test_funnel_stages_decrease(self, client):
        resp = client.get("/api/admin/analytics/funnel", headers=_auth())
        data = resp.json()
        totals = data["funnel"][0]
        assert totals["signed_up"] >= totals["uploaded"]
        assert totals["uploaded"] >= totals["clipped"]


class TestChannelsEndpoint:
    def test_returns_channels(self, client):
        resp = client.get("/api/admin/analytics/channels", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert "channels" in data
        assert len(data["channels"]) >= 1
        ch = data["channels"][0]
        assert "origin" in ch
        assert "signups" in ch
        assert "export_pct" in ch
        assert "avg_exports" in ch
        assert "revenue_cents" in ch


class TestCohortsEndpoint:
    def test_returns_cohorts(self, client):
        resp = client.get("/api/admin/analytics/cohorts", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert "cohorts" in data
        assert "granularity" in data
        assert data["granularity"] == "week"
        if data["cohorts"]:
            c = data["cohorts"][0]
            assert "cohort_period" in c
            assert "signups" in c
            assert "uploaded_pct" in c

    def test_month_granularity(self, client):
        resp = client.get("/api/admin/analytics/cohorts?granularity=month", headers=_auth())
        assert resp.status_code == 200
        assert resp.json()["granularity"] == "month"


class TestJourneyEndpoint:
    def test_returns_journey(self, client_journey):
        resp = client_journey.get("/api/admin/analytics/journey/user-a", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert data["user_id"] == "user-a"
        assert data["email"] == "a@test.com"
        assert "milestones" in data
        assert data["session_count"] >= 0

        completed = [m for m in data["milestones"] if m["at"] is not None]
        pending = [m for m in data["milestones"] if m["at"] is None]
        assert len(completed) >= 5
        assert len(pending) >= 1

    def test_journey_404_unknown_user(self, client):
        resp = client.get("/api/admin/analytics/journey/nonexistent", headers=_auth())
        assert resp.status_code == 404

    def test_journey_403_non_admin(self, client):
        resp = client.get("/api/admin/analytics/journey/user-a", headers=_auth("user-a"))
        assert resp.status_code == 403


class TestPulseEndpoint:
    def test_returns_pulse_cards(self, client):
        resp = client.get("/api/admin/analytics/pulse", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert "cards" in data
        assert "days" in data
        for key in ("signups", "exports", "active_users", "revenue", "viral_conversion"):
            card = data["cards"][key]
            assert "today" in card
            assert "last_week_same_day" in card
            assert "change_pct" in card
            assert "sparkline" in card
            assert isinstance(card["sparkline"], list)
            assert len(card["sparkline"]) > 0
            assert all(isinstance(v, (int, float)) for v in card["sparkline"])
            assert isinstance(card["change_pct"], (int, float))

    def test_pulse_custom_days(self, client):
        resp = client.get("/api/admin/analytics/pulse?days=14", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert data["days"] == 14
        for key in ("signups", "exports", "active_users", "revenue", "viral_conversion"):
            assert len(data["cards"][key]["sparkline"]) == 14


class TestUserActions:
    def test_record_milestone_upserts_action(self, analytics_setup, pg_conn):
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT action, count FROM user_actions WHERE user_id = 'user-a' AND action = 'game_created'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["count"] >= 1

    def test_new_event_records_to_actions(self, analytics_setup, pg_conn):
        record_milestone("user-a", "annotation_completed")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT action, count FROM user_actions WHERE user_id = 'user-a' AND action = 'annotation_completed'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["count"] == 1

    def test_repeat_event_increments_count(self, analytics_setup, pg_conn):
        record_milestone("user-a", "annotation_completed")
        record_milestone("user-a", "annotation_completed")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT count FROM user_actions WHERE user_id = 'user-a' AND action = 'annotation_completed'"
            )
            row = cur.fetchone()
            assert row["count"] == 2

    def test_new_event_daily_counter(self, analytics_setup, pg_conn):
        record_milestone("user-a", "annotation_completed")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT annotations_completed FROM daily_counters WHERE counter_date = CURRENT_DATE AND origin_type = 'all'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["annotations_completed"] >= 1

    def test_event_without_daily_col_skips_counter(self, analytics_setup, pg_conn):
        record_milestone("user-a", "framing_opened")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT action, count FROM user_actions WHERE user_id = 'user-a' AND action = 'framing_opened'"
            )
            row = cur.fetchone()
            assert row is not None
            assert row["count"] == 1

    def test_unknown_event_ignored(self, analytics_setup, pg_conn):
        record_milestone("user-a", "nonexistent_event")
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM user_actions WHERE user_id = 'user-a' AND action = 'nonexistent_event'"
            )
            assert cur.fetchone() is None
