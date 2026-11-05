"""T15120: channel read-out by raw attribution. Rows are seeded onto a fixed old
acquisition date and read through that one-day window, so other rows in the shared
dev database cannot change the counts."""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import create_user_segment
from app.services.auth_db import create_user

DAY = "2020-03-02"
DIMENSIONS = ("origin", "utm_source", "utm_campaign", "utm_content", "click_source",
              "referral_channel")


def _pg():
    from app.services import pg  # looked up at call time: pg_conn patches pg.get_pg
    return pg.get_pg()


def _auth():
    return {"X-User-ID": "admin-user"}


def _acquired(user_id, day):
    with _pg() as conn:
        conn.cursor().execute(
            "UPDATE user_segments SET acquired_at = %s WHERE user_id = %s", (day, user_id))


def _action(user_id, action, first_at=None, platform="desktop"):
    with _pg() as conn:
        conn.cursor().execute(
            "INSERT INTO user_actions (user_id, action, platform, first_at) "
            "VALUES (%s, %s, %s, COALESCE(%s, now()))", (user_id, action, platform, first_at))


@pytest.fixture()
def client(pg_conn, tmp_path):
    create_user("admin-user", email="test-admin@test.local")
    for uid in ("user-a", "user-b", "user-c"):
        create_user(uid, email=f"{uid}@test.com")
    with _pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
    create_user_segment("user-a", "organic", "user-c", "otp", utm_source="meta",
                        utm_campaign="camp-t15120", utm_content="soccer", click_source="ad")
    create_user_segment("user-b", "organic", None, "otp")
    _acquired("user-a", DAY)
    _acquired("user-b", DAY)
    with _pg() as conn:
        conn.cursor().execute(
            "INSERT INTO referrals (referrer_id, referred_id, channel) "
            "VALUES ('user-c', 'user-a', 'endcard')")
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _rows(client, by=None, day=DAY):
    params = {"from": day, "to": day}
    if by:
        params["by"] = by
    resp = client.get("/api/admin/analytics/channels", params=params, headers=_auth())
    assert resp.status_code == 200, resp.text
    return resp.json()


def _by_value(client, by):
    return {r[by]: r for r in _rows(client, by)["channels"]}


class TestDimension:
    def test_default_view_keeps_origin_rows(self, client):
        data = _rows(client)
        assert data["by"] == "origin"
        assert [r["origin"] for r in data["channels"]] == ["organic"]

    def test_null_groups_as_unknown(self, client):
        rows = _by_value(client, "utm_source")
        assert rows["meta"]["signups"] == 1
        assert rows["unknown"]["signups"] == 1

    @pytest.mark.parametrize("by,value", [
        ("utm_campaign", "camp-t15120"), ("utm_content", "soccer"), ("click_source", "ad")])
    def test_each_raw_field_is_a_dimension(self, client, by, value):
        rows = _by_value(client, by)
        assert rows[value]["signups"] == 1
        assert rows["unknown"]["signups"] == 1

    def test_referral_channel_shows_endcard_and_none(self, client):
        rows = _by_value(client, "referral_channel")
        assert rows["endcard"]["signups"] == 1
        assert rows["none"]["signups"] == 1

    @pytest.mark.parametrize("by", DIMENSIONS)
    def test_rows_sum_to_the_window_signups(self, client, by):
        assert sum(r["signups"] for r in _rows(client, by)["channels"]) == 2

    def test_unlisted_dimension_is_refused(self, client):
        resp = client.get("/api/admin/analytics/channels?by=s.user_id", headers=_auth())
        assert resp.status_code == 422

    def test_registered_utm_campaign_carries_its_name(self, client):
        with _pg() as conn:
            conn.cursor().execute(
                "INSERT INTO campaigns (id, name, created_by) "
                "VALUES ('camp-t15120', 'T15120 Test', 'admin-user')")
        try:
            rows = _by_value(client, "utm_campaign")
            assert rows["camp-t15120"]["campaign_name"] == "T15120 Test"
            assert rows["unknown"]["campaign_name"] is None
        finally:
            with _pg() as conn:
                conn.cursor().execute("DELETE FROM campaigns WHERE id = 'camp-t15120'")

    def test_revenue_remainder_still_reconciles_per_dimension(self, client):
        origin = _rows(client)["unattributed_revenue_cents"]
        assert _rows(client, "utm_source")["unattributed_revenue_cents"] == origin


class TestCountColumns:
    def test_distinct_users_per_column(self, client):
        for action in ("game_upload_attempted", "game_upload_succeeded", "paywall_shown",
                       "buy_modal_opened", "credit_purchased"):
            _action("user-a", action)
            _action("user-a", action, platform="mobile")  # one person, two platforms
        _action("user-b", "game_upload_attempted")
        rows = _by_value(client, "utm_source")
        assert rows["meta"]["upload_attempted"] == 1
        assert rows["meta"]["upload_succeeded"] == 1
        assert rows["meta"]["paywall_shown"] == 1
        assert rows["meta"]["buy_modal_opened"] == 1
        assert rows["meta"]["payers"] == 1
        assert rows["unknown"]["upload_attempted"] == 1
        assert rows["unknown"]["upload_succeeded"] == 0
        assert rows["unknown"]["payers"] == 0

    def test_cohorts_and_builds_carry_the_new_columns(self, client):
        window = {"from": DAY, "to": DAY}
        cohort = client.get("/api/admin/analytics/cohorts", params=window, headers=_auth()).json()["cohorts"][0]
        build = client.get("/api/admin/analytics/builds", params=window, headers=_auth()).json()["builds"][0]
        for row in (cohort, build):
            assert row["first_highlight_14d"]["aged"] == 2
            for key in ("upload_attempted", "upload_succeeded", "paywall_shown",
                        "buy_modal_opened", "payers"):
                assert row[key] == 0


class TestFirstHighlight14d:
    def _at(self, day, **delta):
        return datetime(day.year, day.month, day.day, tzinfo=UTC) + timedelta(**delta)

    def test_render_at_exactly_14_days_counts_one_second_later_does_not(self, client):
        start = datetime(2020, 3, 2, tzinfo=UTC)
        _action("user-a", "credits_consumed", start + timedelta(days=14))
        _action("user-b", "credits_consumed", start + timedelta(days=14, seconds=1))
        rows = _by_value(client, "utm_source")
        assert rows["meta"]["first_highlight_14d"] == {"aged": 1, "hit": 1, "pct": 100.0}
        assert rows["unknown"]["first_highlight_14d"] == {"aged": 1, "hit": 0, "pct": 0.0}

    def test_export_completed_also_counts_and_a_user_counts_once(self, client):
        start = datetime(2020, 3, 2, tzinfo=UTC)
        _action("user-a", "export_completed", start + timedelta(days=1))
        _action("user-a", "credits_consumed", start + timedelta(days=2))
        assert _by_value(client, "utm_source")["meta"]["first_highlight_14d"]["hit"] == 1

    def test_acquired_exactly_14_days_ago_is_aged_13_is_not(self, client):
        today = datetime.now(UTC).date()
        aged_day, young_day = today - timedelta(days=14), today - timedelta(days=13)
        _acquired("user-a", aged_day)
        _acquired("user-b", young_day)
        _action("user-b", "credits_consumed", self._at(young_day, days=1))
        assert _rows(client, day=str(aged_day))["channels"][0]["first_highlight_14d"]["aged"] == 1
        young = _rows(client, day=str(young_day))["channels"][0]["first_highlight_14d"]
        assert young == {"aged": 0, "hit": 0, "pct": None}

    def test_test_accounts_stay_excluded(self, client):
        with _pg() as conn:
            conn.cursor().execute(
                "UPDATE users SET is_test_account = true WHERE user_id = 'user-b'")
        total = _rows(client, "referral_channel")["channels"]
        assert sum(r["first_highlight_14d"]["aged"] for r in total) == 1
