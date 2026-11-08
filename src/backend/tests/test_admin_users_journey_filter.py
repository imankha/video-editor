"""T14740: GET /api/admin/users filtered to the users who stopped at a Journey stage.

The list must hold exactly the users the map counts, so every test compares it with the map
endpoint under the same filters. Needs Postgres (pg_conn)."""
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import create_user_segment, deidentify_user_segments, record_milestone
from app.services.auth_db import create_user

TEST_BUILD = 14740  # the shared dev DB holds unrelated users: scope every test to this build


def _auth(user_id="admin-user"):
    return {"X-User-ID": user_id}


def _remove_seeded_users():
    """pg_conn only cleans its fixed id list; these users are found by their private build."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM user_segments WHERE signup_build = %s", (TEST_BUILD,))
        ids = [r["user_id"] for r in cur.fetchall()]
        for table in ("user_actions", "user_segments", "users"):
            cur.execute(f"DELETE FROM {table} WHERE user_id = ANY(%s)", (ids,))


@pytest.fixture()
def client(pg_conn, tmp_path):
    _remove_seeded_users()
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
    _remove_seeded_users()


def _seed(uid, action="clip_created", *, action_days=30, active_days=30, origin="organic",
          platform=None):
    """A user whose furthest stage comes from `action`. Defaults make them gone."""
    from app.services.pg import get_pg
    create_user(uid, email=f"{uid}@test.com")
    create_user_segment(uid, origin, None, "otp")
    record_milestone(uid, action)
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE user_actions SET first_at = now() - make_interval(days => %s), "
                    "platform = COALESCE(%s, platform) WHERE user_id = %s",
                    (action_days, platform, uid))
        cur.execute("UPDATE user_segments SET signup_build = %s, acquired_at = CURRENT_DATE - 60, "
                    "last_active_at = now() - make_interval(days => %s) WHERE user_id = %s",
                    (TEST_BUILD, active_days, uid))


def _seed_clipped(client):
    """At `clipped`: 2 gone, 1 stuck, 1 in window. One user continues, one stops earlier."""
    _seed("gone-1")
    _seed("gone-2")
    _seed("stuck-1", active_days=1)
    _seed("window-1", action_days=2, active_days=1)
    _seed("past-1", "framing_opened")
    _seed("before-1", "session_started")


def _ids(client, **params):
    resp = client.get("/api/admin/users",
                      params={"build": TEST_BUILD, "page_size": 50, **params}, headers=_auth())
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_users"] == len(body["users"])
    return {u["user_id"] for u in body["users"]}


def _map_node(client, stage, **params):
    q = {"build": TEST_BUILD, **params}
    resp = client.get("/api/admin/analytics/journey", params=q, headers=_auth())
    assert resp.status_code == 200, resp.text
    return next(n for n in resp.json()["nodes"] if n["key"] == stage)


class TestStageFilter:
    def test_each_outcome_lists_exactly_those_users(self, client):
        _seed_clipped(client)
        assert _ids(client, journey_stage="clipped", journey_outcome="gone") == {"gone-1", "gone-2"}
        assert _ids(client, journey_stage="clipped", journey_outcome="stuck") == {"stuck-1"}
        assert _ids(client, journey_stage="clipped", journey_outcome="in_window") == {"window-1"}

    def test_lost_is_stuck_plus_gone(self, client):
        _seed_clipped(client)
        assert _ids(client, journey_stage="clipped", journey_outcome="lost") == {
            "gone-1", "gone-2", "stuck-1"}

    def test_several_stages_list_a_collapsed_group(self, client):
        # The map sums a collapsed group's hidden stages into one label.
        _seed("started-gone", "session_started")
        _seed("upload-gone", "add_game_opened")
        _seed("clipped-gone")
        assert _ids(client, journey_stage=["started", "add_footage"], journey_outcome="gone") == {
            "started-gone", "upload-gone"}

    def test_no_match_is_an_empty_list(self, client):
        _seed_clipped(client)
        assert _ids(client, journey_stage="watched", journey_outcome="gone") == set()

    def test_unknown_stage_is_404(self, client):
        resp = client.get("/api/admin/users", headers=_auth(),
                          params={"journey_stage": "nope", "journey_outcome": "gone"})
        assert resp.status_code == 404

    def test_bad_outcome_is_422(self, client):
        resp = client.get("/api/admin/users", headers=_auth(),
                          params={"journey_stage": "clipped", "journey_outcome": "nope"})
        assert resp.status_code == 422

    def test_stage_without_outcome_is_422(self, client):
        resp = client.get("/api/admin/users", headers=_auth(), params={"journey_stage": "clipped"})
        assert resp.status_code == 422

    def test_combined_with_a_user_filter_pill_is_422(self, client):
        # The UI keeps them exclusive; the two tombstone populations cannot both apply.
        resp = client.get("/api/admin/users", headers=_auth(), params={
            "journey_stage": "clipped", "journey_outcome": "gone", "filter": "paying"})
        assert resp.status_code == 422

    def test_non_admin_403(self, client):
        create_user("regular-user", email="regular@test.com")
        resp = client.get("/api/admin/users", headers=_auth("regular-user"),
                          params={"journey_stage": "clipped", "journey_outcome": "gone"})
        assert resp.status_code == 403

    def test_without_a_stage_the_list_is_unfiltered(self, client):
        _seed_clipped(client)
        assert len(_ids(client)) == 6


class TestMatchesTheMap:
    @pytest.mark.parametrize("outcome", ["in_window", "stuck", "gone"])
    def test_count_equals_the_map_node(self, client, outcome):
        _seed_clipped(client)
        node = _map_node(client, "clipped")
        assert node[outcome] > 0
        assert len(_ids(client, journey_stage="clipped", journey_outcome=outcome)) == node[outcome]

    def test_window_and_inactivity_controls_follow_the_map(self, client):
        _seed_clipped(client)
        controls = {"window_days": 7, "inactive_days": 31}
        node = _map_node(client, "clipped", **controls)
        assert (node["in_window"], node["stuck"], node["gone"]) == (1, 3, 0)
        assert len(_ids(client, journey_stage="clipped", journey_outcome="stuck", **controls)) == 3

    def test_platform_follows_the_map(self, client):
        _seed("mobile-1", platform="pwa-mobile")
        _seed("desktop-1", platform="webapp-desktop")
        node = _map_node(client, "clipped", platform="mobile")
        assert node["gone"] == 1
        assert _ids(client, journey_stage="clipped", journey_outcome="gone",
                    platform="mobile") == {"mobile-1"}

    def test_signup_dates_and_campaign_follow_the_map(self, client):
        _seed("paid-1", origin="paid")
        _seed("organic-1", origin="organic")
        today = date.today()
        window = {"from": (today - timedelta(days=90)).isoformat(), "to": today.isoformat()}
        node = _map_node(client, "clipped", origin="paid", **window)
        assert node["gone"] == 1
        assert _ids(client, journey_stage="clipped", journey_outcome="gone", origin="paid",
                    acquired_from=window["from"], acquired_to=window["to"]) == {"paid-1"}
        out_of_range = (today - timedelta(days=30)).isoformat()
        assert _ids(client, journey_stage="clipped", journey_outcome="gone",
                    acquired_from=out_of_range) == set()

    def test_test_accounts_follow_the_real_pill(self, client):
        from app.services.pg import get_pg
        _seed("real-1")
        _seed("internal-1")
        with get_pg() as conn:
            conn.cursor().execute(
                "UPDATE users SET is_test_account = true WHERE user_id = 'internal-1'")
        assert _ids(client, journey_stage="clipped", journey_outcome="gone") == {"real-1"}
        assert _ids(client, journey_stage="clipped", journey_outcome="gone",
                    exclude_test=False) == {"real-1", "internal-1"}

    def test_a_deleted_account_the_map_counts_is_listed(self, client):
        # Account deletion keeps the de-identified user_segments row, and the map counts it.
        from app.services.pg import get_pg
        _seed("live-1")
        _seed("deleted-1")
        with get_pg() as conn:
            cur = conn.cursor()
            deidentify_user_segments(cur, "deleted-1", False)
            cur.execute("DELETE FROM users WHERE user_id = 'deleted-1'")
        assert _map_node(client, "clipped")["gone"] == 2
        resp = client.get("/api/admin/users", headers=_auth(), params={
            "build": TEST_BUILD, "journey_stage": "clipped", "journey_outcome": "gone"})
        rows = {u["user_id"]: u for u in resp.json()["users"]}
        assert set(rows) == {"live-1", "deleted-1"}
        assert rows["deleted-1"]["email"] == "Deleted account"
        assert resp.json()["total_users"] == 2


    def test_step_inspector_survives_a_deleted_account(self, client):
        # T15290: a deleted account keeps its analytics (last_active_at included), so it is
        # ordered by activity like any other; the inspector must still list it as gone.
        from app.services.pg import get_pg
        _seed("live-1")
        _seed("deleted-1")
        with get_pg() as conn:
            cur = conn.cursor()
            deidentify_user_segments(cur, "deleted-1", False)
            cur.execute("DELETE FROM users WHERE user_id = 'deleted-1'")
        resp = client.get("/api/admin/analytics/journey/step/clipped", headers=_auth(),
                          params={"build": TEST_BUILD})
        assert resp.status_code == 200, resp.text
        assert sorted(p["user_id"] for p in resp.json()["people"]["gone"]) == ["deleted-1", "live-1"]


class TestListBehaviour:
    def test_pagination_and_sort_keep_working(self, client):
        for i in range(3):
            _seed(f"gone-{i}", active_days=30 + i)
        q = {"build": TEST_BUILD, "journey_stage": "clipped", "journey_outcome": "gone",
             "page_size": 2, "sort": "last_active_at", "sort_dir": "desc"}
        first = client.get("/api/admin/users", params={**q, "page": 1}, headers=_auth()).json()
        second = client.get("/api/admin/users", params={**q, "page": 2}, headers=_auth()).json()
        assert first["total_users"] == 3 and first["total_pages"] == 2
        assert [u["user_id"] for u in first["users"]] == ["gone-0", "gone-1"]
        assert [u["user_id"] for u in second["users"]] == ["gone-2"]

    def test_funnel_totals_describe_the_filtered_users(self, client):
        _seed_clipped(client)
        body = client.get("/api/admin/users", headers=_auth(), params={
            "build": TEST_BUILD, "journey_stage": "clipped", "journey_outcome": "gone"}).json()
        totals = body["funnel_totals"]
        assert totals["signed_up"] == 2
        assert max(v for k, v in totals.items() if k != "signed_up") <= 2

    def test_dashboard_still_calls_list_users_directly(self, client):
        # get_admin_dashboard calls list_users without the new params.
        resp = client.get("/api/admin/dashboard", headers=_auth())
        assert resp.status_code == 200, resp.text
