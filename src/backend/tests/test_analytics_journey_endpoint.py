"""T14010: GET /api/admin/analytics/journey against Postgres -- classification at the
window / inactivity boundaries, conservation over HTTP, implied reach, filters, major stages.

Imports only symbols that predate T14010, so against a pre-T14010 revision these fail
on behaviour (the route is missing), not at import."""
from datetime import date, timedelta
from itertools import pairwise
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import create_user_segment, record_milestone
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

    def test_conservation_over_http_and_implied_reach(self, journey_client):
        _user("test-user")
        for a in ("session_started", "export_completed", "overlay_exported"):
            record_milestone("test-user", a)
        _age("test-user", action_days=30, active_days=0)
        data = _get(journey_client)
        for n in data["nodes"]:
            assert n["reached"] == n["continued"] + n["in_window"] + n["stuck"] + n["gone"]
        keys = [n["key"] for n in data["nodes"]]
        assert [(e["from"], e["to"]) for e in data["edges"]] == list(
            pairwise(keys[:keys.index("finished") + 1]))
        counts = [n["reached"] for n in data["nodes"]]
        assert counts == sorted(counts, reverse=True)
        assert _by_key(data)["spotlight_opened"]["reached"] == 1
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

    def test_major_flags_meta_and_money_and_no_full_mode(self, journey_client):
        _user("other-regular")
        record_milestone("other-regular", "paywall_shown")
        data = _get(journey_client)
        assert [n["key"] for n in data["nodes"] if n["major"]] == [
            "signed_up", "clipped", "exported", "finished", "took_away"]
        assert all(isinstance(n["major"], bool) for n in data["nodes"])
        assert data["meta"]["window_days"] == 14 and data["meta"]["inactive_days"] == 14
        assert "steps" not in data["meta"]
        assert [n["key"] for n in data["money"]["nodes"]] == [
            "paywall_shown", "buy_modal_opened", "credit_purchased"]
        assert data["money"]["nodes"][0]["reached"] == 1
        # The full mode is gone: a stale steps=full is ignored, never a 22-node map.
        assert len(_get(journey_client, steps="full")["nodes"]) == 16

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


# ---------------------------------------------------------------------------
# T14020: GET /analytics/journey/step/{stage} and the session_exit trail
# ---------------------------------------------------------------------------
def _step(client, stage, **params):
    q = {"from": (date.today() - timedelta(days=200)).isoformat(),
         "to": date.today().isoformat(), "build": TEST_BUILD, **params}
    resp = client.get(f"/api/admin/analytics/journey/step/{stage}", params=q, headers=_auth())
    assert resp.status_code == 200, resp.text
    return resp.json()


def _insert_action(uid, action, *, days_ago=0):
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO user_actions (user_id, action, platform, first_at) "
            "VALUES (%s, %s, 'pwa-mobile', now() - make_interval(days => %s)) "
            "ON CONFLICT (user_id, action, platform) DO NOTHING", (uid, action, days_ago))


class TestStepInspector:
    def _seed(self):
        # started: 2 stuck, 1 gone, 1 continued to add_footage
        for uid, active in (("user-1", 0), ("user-2", 3), ("user-a", 40)):
            _user(uid)
            record_milestone(uid, "session_started")
            _age(uid, action_days=30, active_days=active)
        _user("user-b")
        for a in ("session_started", "add_game_opened"):
            record_milestone("user-b", a)
        _age("user-b", action_days=30, active_days=0)

    def test_counts_equal_the_map_node(self, journey_client):
        self._seed()
        step = _step(journey_client, "started")
        node = _by_key(_get(journey_client))["started"]
        for k in ("reached", "continued", "in_window", "stuck", "gone"):
            assert step["counts"][k] == node[k], k
        assert step["stage"] == "started" and step["counts"]["reached"] == 4

    def test_a_skipped_stage_includes_the_user_and_equals_the_map_node(self, journey_client):
        _user("user-1")
        for a in ("session_started", "clip_created"):  # never opened the upload screen
            record_milestone("user-1", a)
        _age("user-1", action_days=30, active_days=0)
        _user("user-2")
        for a in ("session_started", "add_game_opened"):
            record_milestone("user-2", a)
        _age("user-2", action_days=30, active_days=0)
        step = _step(journey_client, "add_footage")
        node = _by_key(_get(journey_client))["add_footage"]
        for k in ("reached", "continued", "in_window", "stuck", "gone"):
            assert step["counts"][k] == node[k], k
        assert (step["counts"]["reached"], step["counts"]["continued"]) == (2, 1)
        assert (step["next"]["continued"], step["next"]["timed"]) == (1, 0)
        assert step["next"]["median_s"] is None

    def test_people_per_outcome_and_email(self, journey_client):
        self._seed()
        people = _step(journey_client, "started")["people"]
        assert {p["user_id"] for p in people["stuck"]} == {"user-1", "user-2"}
        assert [p["user_id"] for p in people["gone"]] == ["user-a"]
        assert people["stuck"][0]["email"].endswith("@test.com")
        assert people["in_window"] == []

    def test_next_timing_and_breakdown_sorted_by_loss(self, journey_client):
        self._seed()
        data = _step(journey_client, "started", by="platform")
        assert data["next"]["stage"] == "add_footage"
        assert data["next"]["n"] + data["next"]["out_of_order"] == 1
        row = data["breakdown"][0]
        assert row["reached"] == 4 and row["stuck"] == 2 and row["gone"] == 1
        assert row["rate"] == {"pct": None, "k": 1, "n": 4}
        assert "rate_lb" in row
        by_build = _step(journey_client, "started", by="build")["breakdown"]
        assert by_build[0]["key"] == str(TEST_BUILD)

    def test_why_failures_and_impressions_for_users_who_stopped(self, journey_client):
        self._seed()
        _insert_action("user-1", "game_upload_failed:timeout")
        _insert_action("user-2", "game_upload_failed:timeout")
        _insert_action("user-a", "dialog_impression:file_too_large")
        _insert_action("user-b", "game_upload_failed:network")  # continued: not "stopped"
        why = _step(journey_client, "started")["why"]
        assert why["failures"] == [{"event": "game_upload_failed", "reason": "timeout", "users": 2}]
        assert why["impressions"] == [{"slug": "dialog_impression:file_too_large", "users": 1}]

    def test_instead_hidden_below_five_per_side_and_labelled(self, journey_client):
        self._seed()
        _insert_action("user-1", "paywall_shown")
        data = _step(journey_client, "started")
        assert data["instead"] == []
        assert data["instead_note"] == "correlation, not cause"

    def test_unknown_stage_404_bad_dimension_422_non_admin_403(self, journey_client):
        _user("regular-user")
        assert journey_client.get("/api/admin/analytics/journey/step/started",
                                  headers=_auth("regular-user")).status_code == 403
        assert journey_client.get("/api/admin/analytics/journey/step/nope",
                                  headers=_auth()).status_code == 404
        assert journey_client.get("/api/admin/analytics/journey/step/started?by=shoe",
                                  headers=_auth()).status_code == 422

    def test_signed_up_stage_includes_everyone(self, journey_client):
        _user("user-1")
        data = _step(journey_client, "signed_up")
        assert data["counts"]["reached"] == 1


class TestSessionExitTrail:
    def test_user_journey_returns_session_exit_rows(self, journey_client):
        from app.analytics import record_session_exit
        _user("user-1")
        record_session_exit("user-1", "framing", {"annotate": 12.5, "framing": 80.0},
                            ["annotate", "framing"])
        resp = journey_client.get("/api/admin/analytics/journey/user-1", headers=_auth())
        assert resp.status_code == 200, resp.text
        exits = resp.json()["session_exits"]
        assert len(exits) == 1
        assert exits[0]["last_screen"] == "framing"
        assert exits[0]["dwell"] == {"annotate": 12.5, "framing": 80.0}
        assert exits[0]["trail"] == ["annotate", "framing"]
        assert exits[0]["at"]

    def test_no_rows_is_empty_list(self, journey_client):
        _user("user-1")
        resp = journey_client.get("/api/admin/analytics/journey/user-1", headers=_auth())
        assert resp.json()["session_exits"] == []


def test_step_why_reports_retry_burst_sample(journey_client):
    from app.services.user_db import get_user_db_connection
    _user("user-1")
    record_milestone("user-1", "session_started")
    _age("user-1", action_days=30, active_days=0)
    with get_user_db_connection("user-1") as conn:
        for i in range(3):
            conn.execute("INSERT INTO user_action_log (action, context, created_at) VALUES "
                         "('game_created', NULL, ?)", (f"2026-10-01T10:00:0{i}Z",))
        conn.commit()
    why = _step(journey_client, "started")["why"]
    assert why["retry_bursts"] == {"sampled": 1, "with_bursts": 1, "by_action": {"game_created": 1}}
