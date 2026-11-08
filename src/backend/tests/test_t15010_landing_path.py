"""T15010: the landing page that converted, stored at sign-up and readable in admin.
Rows sit on a fixed old acquisition date and are read through that one-day window, so
other rows in the shared dev database cannot change the counts."""

from unittest.mock import AsyncMock, patch

import psycopg2
import pytest
from fastapi.testclient import TestClient

from app.analytics import create_user_segment
from app.services.auth_db import create_user
from tests.conftest import register_test_user_ids

DAY = "2020-03-03"


def _pg():
    from app.services import pg  # looked up at call time: pg_conn patches pg.get_pg
    return pg.get_pg()


def _auth():
    return {"X-User-ID": "admin-user"}


def _acquired(user_id, day=DAY):
    with _pg() as conn:
        conn.cursor().execute(
            "UPDATE user_segments SET acquired_at = %s WHERE user_id = %s", (day, user_id))


def _stored_landing_path(user_id):
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT to_jsonb(s) ->> 'landing_path' AS landing_path FROM user_segments s "
                    "WHERE s.user_id = %s", (user_id,))
        return cur.fetchone()["landing_path"]


@pytest.fixture()
def client(pg_conn, tmp_path):
    create_user("admin-user", email="test-admin@test.local")
    with _pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.routers.auth._send_welcome_email", new=AsyncMock()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _otp_signup(client, email, **params):
    with _pg() as conn:
        conn.cursor().execute(
            "INSERT INTO otp_codes (email, code, expires_at) "
            "VALUES (%s, '123456', now() + interval '10 min')", (email,))
    r = client.post("/api/auth/verify-otp", json={"email": email, "code": "123456", **params})
    assert r.status_code == 200, r.text
    return _signed_up(client, email)


def _google_signup(client, email, **params):
    token = {"email": email, "sub": f"sub-{email}"}
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=token)):
        r = client.post("/api/auth/google", json={"token": "t", **params})
    assert r.status_code == 200, r.text
    return _signed_up(client, email)


def _signed_up(client, email):
    client.cookies.clear()
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM users WHERE email = %s", (email,))
        user_id = cur.fetchone()["user_id"]
        cur.execute("DELETE FROM otp_codes WHERE email = %s", (email,))
    register_test_user_ids(user_id)
    return user_id


# --- Sign-up write -----------------------------------------------------------

def test_otp_signup_stores_landing_path(client):
    user_id = _otp_signup(client, "t15010-otp@test.local", landing_path="/works-with/trace")
    assert _stored_landing_path(user_id) == "/works-with/trace"


def test_google_signup_stores_landing_path(client):
    user_id = _google_signup(client, "t15010-g@test.local", landing_path="/soccer")
    assert _stored_landing_path(user_id) == "/soccer"


@pytest.mark.parametrize("bad", [
    "no-leading-slash", "/has spaces", "/semi;colon", "/" + "a" * 121, "/<script>",
])
def test_invalid_landing_path_is_dropped_never_stored(client, bad):
    """Never a 4xx: a bad value is dropped with a warning, not rejected."""
    user_id = _otp_signup(client, f"t15010-bad-{abs(hash(bad))}@test.local", landing_path=bad)
    assert _stored_landing_path(user_id) is None


def test_signup_without_landing_path_stores_null(client):
    user_id = _otp_signup(client, "t15010-none@test.local")
    assert _stored_landing_path(user_id) is None


def test_signup_succeeds_before_the_migration(pg_conn, caplog):
    """Migration window: the segment lands without its landing_path and the gap is logged."""
    import app.analytics as analytics

    create_user("user-lp", email="lp@test.com")
    register_test_user_ids("user-lp")
    hidden = "landing_path_t15010_hidden"
    with _pg() as conn:
        conn.cursor().execute(f"ALTER TABLE user_segments RENAME COLUMN landing_path TO {hidden}")
    try:
        analytics._landing_path_column_present = False
        with caplog.at_level("ERROR", logger="app.analytics"):
            create_user_segment("user-lp", "organic", None, "otp", landing_path="/soccer")
        with _pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT origin FROM user_segments WHERE user_id = 'user-lp'")
            assert cur.fetchone() == {"origin": "organic"}
        assert any("landing_path" in r.getMessage() for r in caplog.records if r.levelname == "ERROR")
    finally:
        with _pg() as conn:
            conn.cursor().execute(f"ALTER TABLE user_segments RENAME COLUMN {hidden} TO landing_path")
        analytics._landing_path_column_present = False


# --- Migration ---------------------------------------------------------------

def test_migration_adds_the_column_and_is_idempotent(pg_conn):
    import os

    from app.migrations.postgres import MIGRATIONS
    from app.services.pg import _SCHEMA_DDL

    segments_ddl = _SCHEMA_DDL.split("CREATE TABLE IF NOT EXISTS user_segments")[1]
    assert "landing_path TEXT" in segments_ddl.split("idx_segments_acquired")[0]
    migration = next((m for m in MIGRATIONS if "user_segments.landing_path" in m.description), None)
    assert migration is not None, "no migration adds user_segments.landing_path"

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:  # one transaction, rolled back: the shared dev DB keeps its column
        cur = conn.cursor()
        cur.execute("ALTER TABLE user_segments DROP COLUMN IF EXISTS landing_path")
        migration.up(conn)
        migration.up(conn)
        cur.execute("SELECT data_type FROM information_schema.columns "
                    "WHERE table_name = 'user_segments' AND column_name = 'landing_path'")
        assert cur.fetchall() == [("text",)]
    finally:
        conn.rollback()
        conn.close()


# --- Admin reads -------------------------------------------------------------

@pytest.fixture()
def seeded(client):
    """user-a a sport page, user-b a camera page, user-c no landing page."""
    for uid, lp in (("user-a", "/soccer"), ("user-b", "/works-with/trace"), ("user-c", None)):
        create_user(uid, email=f"{uid}@test.com")
        with _pg() as conn:
            conn.cursor().execute("DELETE FROM user_segments WHERE user_id = %s", (uid,))
        create_user_segment(uid, "organic", None, "otp", landing_path=lp)
        _acquired(uid)
        with _pg() as conn:
            conn.cursor().execute(
                "INSERT INTO user_actions (user_id, action, platform) "
                "VALUES (%s, 'session_started', 'desktop')", (uid,))
    return client


def test_step_inspector_breaks_down_by_landing_path_page_class(seeded):
    r = seeded.get("/api/admin/analytics/journey/step/started",
                   params={"by": "landing_path", "from": DAY, "to": DAY}, headers=_auth())
    assert r.status_code == 200, r.text
    assert {b["key"]: b["reached"] for b in r.json()["breakdown"]} == {
        "sport": 1, "works-with": 1, "unknown": 1,
    }


def test_unrecognized_by_value_is_rejected(seeded):
    r = seeded.get("/api/admin/analytics/journey/step/started",
                   params={"by": "not_a_real_dimension", "from": DAY, "to": DAY}, headers=_auth())
    assert r.status_code == 422


def test_user_detail_panel_shows_landing_path(seeded):
    r = seeded.get("/api/admin/analytics/journey/user-b", headers=_auth())
    assert r.status_code == 200, r.text
    assert r.json()["landing_path"] == "/works-with/trace"


def test_user_detail_panel_landing_path_is_null_without_one(seeded):
    r = seeded.get("/api/admin/analytics/journey/user-c", headers=_auth())
    assert r.status_code == 200, r.text
    assert r.json()["landing_path"] is None
