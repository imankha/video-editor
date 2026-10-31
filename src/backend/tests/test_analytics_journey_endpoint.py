"""T14010: GET /api/admin/analytics/journey against Postgres -- classification at the
window / inactivity boundaries, conservation over HTTP, skip edges, filters, full mode.

Imports only symbols that predate T14010, so against a pre-T14010 revision these fail
on behaviour (the route is missing), not at import."""
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import FUNNEL_STEPS, create_user_segment, record_milestone
from app.services.auth_db import create_user

# The shared dev DB holds unrelated users: every test scopes to this private build id.
TEST_BUILD = 14010


def _auth(user_id="admin-user"):
    return {"X-User-ID": user_id}


def _age(user_id, *, action_days=None, active_days=0, acquired_days=60):
    """Backdate a user: every action's first_at, last_active_at and acquired_at."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        if action_days is not None:
            cur.execute("UPDATE user_actions SET first_at = now() - make_interval(days => %s) "
                        "WHERE user_id = %s", (action_days, user_id))
        cur.execute("UPDATE user_segments SET last_active_at = now() - make_interval(days => %s), "
                    "acquired_at = CURRENT_DATE - %s WHERE user_id = %s",
                    (active_days, acquired_days, user_id))


@pytest.fixture()
def journey_client(pg_conn, tmp_path):
    create_user("admin-user", email="test-admin@test.local")
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _user(uid, origin="organic"):
    create_user(uid, email=f"{uid}@test.com")
    create_user_segment(uid, origin, None, "otp")
    # The shared dev DB holds unrelated users: scope every test to a private build id.
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute("UPDATE user_segments SET signup_build = %s WHERE user_id = %s",
                              (TEST_BUILD, uid))


def _get(client, **params):
    q = {"from": (date.today() - timedelta(days=200)).isoformat(),
         "to": date.today().isoformat(), "build": TEST_BUILD, **params}
    resp = client.get("/api/admin/analytics/journey", params=q, headers=_auth())
    assert resp.status_code == 200, resp.text
    return resp.json()


def _by_key(data):
    return {n["key"]: n for n in data["nodes"]}


class TestEndpoint:
    def test_non_admin_403(self, journey_client):
        _user("regular-user")
        resp = journey_client.get("/api/admin/analytics/journey", headers=_auth("regular-user"))
        assert resp.status_code == 403

    def test_classification_at_window_and_inactivity_boundaries(self, journey_client):
        # All four stop at "started". W=14, I=14.
        for uid, action_days, active_days in [
            ("user-1", 13, 0),    # inside window  -> in_window
            ("user-2", 15, 13),     # past window, active within I -> stuck
            ("user-a", 15, 15),      # past window, idle >= I -> gone
            ("user-b", 30, 20),
        ]:
            _user(uid)
            record_milestone(uid, "session_started")
            _age(uid, action_days=action_days, active_days=active_days)
        started = _by_key(_get(journey_client))["started"]
        assert started["reached"] == 4
        assert (started["in_window"], started["stuck"], started["gone"]) == (1, 1, 2)
        assert started["continued"] == 0

    def test_window_and_inactivity_controls_change_split(self, journey_client):
        _user("user-c")
        record_milestone("user-c", "session_started")
        _age("user-c", action_days=10, active_days=10)
        wide = _by_key(_get(journey_client, window_days=14))["started"]
        assert wide["in_window"] == 1
        narrow = _by_key(_get(journey_client, window_days=7, inactive_days=14))["started"]
        assert narrow["stuck"] == 1
        idle = _by_key(_get(journey_client, window_days=7, inactive_days=5))["started"]
        assert idle["gone"] == 1

    def test_conservation_over_http_and_skip_edge(self, journey_client):
        _user("test-user")
        for a in ("session_started", "export_completed", "overlay_exported"):
            record_milestone("test-user", a)
        _age("test-user", action_days=30, active_days=0)
        data = _get(journey_client)
        for n in data["nodes"]:
            assert n["reached"] == n["continued"] + n["in_window"] + n["stuck"] + n["gone"]
        edge = next(e for e in data["edges"] if e["from"] == "exported")
        assert edge["to"] == "finished" and edge["skip"] is True
        assert _by_key(data)["finished"]["stuck"] == 1

    def test_filters_origin_build_platform_and_test_exclusion(self, journey_client):
        _user("test-user-1", "organic")
        _user("target-user", "paid")
        for u in ("test-user-1", "target-user"):
            record_milestone(u, "session_started")
        assert _by_key(_get(journey_client))["signed_up"]["reached"] == 2
        assert _by_key(_get(journey_client, origin="paid"))["signed_up"]["reached"] == 1
        assert _by_key(_get(journey_client, build=987654))["signed_up"]["reached"] == 0
        from app.services.pg import get_pg
        with get_pg() as conn:
            conn.cursor().execute("UPDATE users SET is_test_account = true WHERE user_id = 'target-user'")
        assert _by_key(_get(journey_client))["signed_up"]["reached"] == 1
        assert _by_key(_get(journey_client, exclude_test="false"))["signed_up"]["reached"] == 2

    def test_full_mode_and_meta_and_money(self, journey_client):
        _user("other-regular")
        record_milestone("other-regular", "paywall_shown")
        data = _get(journey_client, steps="full")
        assert len(data["nodes"]) == len(FUNNEL_STEPS) + 1
        assert data["meta"]["window_days"] == 14 and data["meta"]["inactive_days"] == 14
        compact = _get(journey_client)
        assert [n["key"] for n in compact["money"]["nodes"]] == [
            "paywall_shown", "buy_modal_opened", "credit_purchased"]
        assert compact["money"]["nodes"][0]["reached"] == 1

    def test_invalid_steps_422(self, journey_client):
        resp = journey_client.get("/api/admin/analytics/journey?steps=bogus", headers=_auth())
        assert resp.status_code == 422

    def test_no_signup_range_means_all_signups_like_the_users_list(self, journey_client):
        # The Journey section reads AdminScreen's global filters; with no date range set
        # the users list shows every signup, so the map must too (no hidden 90-day window).
        _user("user-a")
        _age("user-a", acquired_days=400)
        resp = journey_client.get("/api/admin/analytics/journey",
                                  params={"build": TEST_BUILD}, headers=_auth())
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert _by_key(data)["signed_up"]["reached"] == 1
        # The window starts at the earliest included signup, so stages instrumented
        # later than that are badged partial.
        assert data["meta"]["from"] == (date.today() - timedelta(days=400)).isoformat()
        assert _by_key(data)["watched"]["partial_from"] == "2026-09-15"

    def test_platform_filter_is_device_family_over_the_stored_keys(self, journey_client):
        # Stored keys are pwa-/webapp- x mobile/desktop (user_context._VALID_PLATFORMS); the
        # app records no iOS vs Android split. The filter is the device family.
        from app.services.pg import get_pg
        for uid, key in (("user-1", "pwa-mobile"), ("user-2", "webapp-mobile"), ("user-a", "pwa-desktop")):
            _user(uid)
            record_milestone(uid, "session_started")
            with get_pg() as conn:
                conn.cursor().execute("UPDATE user_actions SET platform = %s WHERE user_id = %s", (key, uid))
        assert _by_key(_get(journey_client))["started"]["reached"] == 3
        assert _by_key(_get(journey_client, platform="mobile"))["started"]["reached"] == 2
        assert _by_key(_get(journey_client, platform="desktop"))["started"]["reached"] == 1
        resp = journey_client.get("/api/admin/analytics/journey",
                                  params={"platform": "ios", "build": TEST_BUILD}, headers=_auth())
        assert resp.status_code == 422
