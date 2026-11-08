"""T14930: `sport` filter on GET /api/admin/analytics/journey, /journey/step/{stage}
(`by=arrival_sport`), GET /api/admin/users and the spend-readiness payload -- a predicate
on `user_segments.utm_content` restricted to the known sport keys. Anything else
(an ad's own utm_content, or none) is "unknown"; never inferred, never backfilled.
Needs Postgres (pg_conn)."""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import create_user_segment, record_milestone
from app.services.auth_db import create_user

TEST_BUILD = 14930  # the shared dev DB holds unrelated users: scope every test to this build


def _auth(user_id="admin-user"):
    return {"X-User-ID": user_id}


def _remove_seeded_users():
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


def _seed(uid, *, utm_content=None):
    from app.services.pg import get_pg
    create_user(uid, email=f"{uid}@test.com")
    create_user_segment(uid, "organic", None, "otp", utm_content=utm_content)
    record_milestone(uid, "clip_created")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE user_segments SET signup_build = %s, acquired_at = CURRENT_DATE - 60 "
                    "WHERE user_id = %s", (TEST_BUILD, uid))


def _seed_three(client):
    """One known sport, one ad-set utm_content, one with no utm_content at all. The last
    two must both land in "unknown" -- there is no inference between an ad and a direct
    arrival, only the known/unknown split."""
    _seed("hockey-1", utm_content="hockey")
    _seed("ad-1", utm_content="my_ad_campaign")
    _seed("direct-1", utm_content=None)


def _ids(client, **params):
    resp = client.get("/api/admin/users",
                      params={"build": TEST_BUILD, "page_size": 50, **params}, headers=_auth())
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total_users"] == len(body["users"])
    return {u["user_id"] for u in body["users"]}


def _signed_up_reached(client, **params):
    resp = client.get("/api/admin/analytics/journey",
                      params={"build": TEST_BUILD, **params}, headers=_auth())
    assert resp.status_code == 200, resp.text
    node = next(n for n in resp.json()["nodes"] if n["key"] == "signed_up")
    return node["reached"]


class TestKnownSportFilter:
    def test_users_list_narrows_to_the_known_sport(self, client):
        _seed_three(client)
        assert _ids(client, sport="hockey") == {"hockey-1"}

    def test_unknown_bucket_covers_both_an_ads_own_value_and_no_value(self, client):
        _seed_three(client)
        assert _ids(client, sport="unknown") == {"ad-1", "direct-1"}

    def test_journey_map_and_users_list_agree_on_counts(self, client):
        _seed_three(client)
        assert _signed_up_reached(client, sport="hockey") == len(_ids(client, sport="hockey"))
        assert _signed_up_reached(client, sport="unknown") == len(_ids(client, sport="unknown"))

    def test_unrecognized_sport_value_is_rejected(self, client):
        resp = client.get("/api/admin/users", params={"build": TEST_BUILD, "sport": "curling"},
                          headers=_auth())
        assert resp.status_code == 422


class TestStepBreakdownByArrivalSport:
    def test_breakdown_rows_match_the_known_and_unknown_split(self, client):
        _seed_three(client)
        resp = client.get("/api/admin/analytics/journey/step/signed_up",
                          params={"build": TEST_BUILD, "by": "arrival_sport"}, headers=_auth())
        assert resp.status_code == 200, resp.text
        rows = {r["key"]: r["reached"] for r in resp.json()["breakdown"]}
        assert rows == {"hockey": 1, "unknown": 2}


class TestSpendReadinessAcceptsSport:
    def test_sport_filter_does_not_error_the_gates_payload(self, client):
        _seed_three(client)
        resp = client.get("/api/admin/analytics/spend-readiness", params={"sport": "hockey"},
                          headers=_auth())
        assert resp.status_code == 200, resp.text
        assert "gates" in resp.json()

    def test_unrecognized_sport_value_is_rejected(self, client):
        resp = client.get("/api/admin/analytics/spend-readiness", params={"sport": "curling"},
                          headers=_auth())
        assert resp.status_code == 422
