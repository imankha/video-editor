"""T16900: the referring website is stored at sign-up, a sign-up with no source signal is
`direct` (no referring website) or `other-website` (one not on our list), email and AI
assistants get their own buckets, and admin Campaigns groups by medium, term and
referring website. Rows sit on a fixed old acquisition date and are read through that
one-day window, so other rows in the shared dev database cannot change the counts."""

from unittest.mock import AsyncMock, patch

import psycopg2
import pytest
from fastapi.testclient import TestClient

from app.analytics import (
    CAMPAIGN_ID_ALPHABET,
    CAMPAIGN_ID_LENGTH,
    _is_reserved_origin,
    create_user_segment,
)
from app.services.auth_db import create_user
from tests.conftest import register_test_user_ids

DAY = "2020-03-04"


def _pg():
    from app.services import pg  # looked up at call time: pg_conn patches pg.get_pg
    return pg.get_pg()


def _auth():
    return {"X-User-ID": "admin-user"}


def _acquired(user_id, day=DAY):
    with _pg() as conn:
        conn.cursor().execute(
            "UPDATE user_segments SET acquired_at = %s WHERE user_id = %s", (day, user_id))


def _segment(user_id):
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT origin, to_jsonb(s) ->> 'referrer_host' AS referrer_host "
                    "FROM user_segments s WHERE s.user_id = %s", (user_id,))
        return dict(cur.fetchone())


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


# --- AC1: no source signal ---------------------------------------------------

def test_signup_with_no_signal_is_direct_and_stores_no_host(client):
    user_id = _otp_signup(client, "t16900-none@test.local")
    assert _segment(user_id) == {"origin": "direct", "referrer_host": None}


# --- AC2: an unlisted website -------------------------------------------------

def test_signup_from_unlisted_website_stores_host_and_is_other_website(client):
    user_id = _google_signup(client, "t16900-blog@test.local",
                             referrer_host="  Some-Blog.Example:8080 ")
    assert _segment(user_id) == {"origin": "other-website", "referrer_host": "some-blog.example"}


@pytest.mark.parametrize("bad", ["a b", "http://x.com/p", "x" * 254, "[::1]", "ex..com"])
def test_invalid_referrer_host_is_dropped_never_rejected(client, bad):
    user_id = _otp_signup(client, f"t16900-bad-{abs(hash(bad))}@test.local", referrer_host=bad)
    assert _segment(user_id) == {"origin": "direct", "referrer_host": None}


def test_host_is_stored_even_when_a_campaign_sets_the_origin(client):
    user_id = _otp_signup(client, "t16900-camp@test.local",
                          utm_campaign="spring-t16900", referrer_host="www.google.com")
    assert _segment(user_id) == {"origin": "spring-t16900", "referrer_host": "www.google.com"}


# --- AC3: email and AI assistants ------------------------------------------

@pytest.mark.parametrize("host,origin", [("mail.google.com", "email"), ("chatgpt.com", "ai")])
def test_email_and_ai_referrers_get_their_own_origin(client, host, origin):
    user_id = _otp_signup(client, f"t16900-{origin}@test.local", referrer_host=host)
    assert _segment(user_id) == {"origin": origin, "referrer_host": host}


@pytest.mark.parametrize("value", ["direct", "other-website", "email", "ai"])
def test_new_origins_are_reserved_and_no_campaign_id_can_equal_them(value):
    assert _is_reserved_origin(value)
    assert len(value) != CAMPAIGN_ID_LENGTH or not set(value) <= set(CAMPAIGN_ID_ALPHABET)


# --- AC4: admin grouping -----------------------------------------------------

@pytest.fixture()
def seeded(client):
    """user-a: email medium + a referring website; user-b: neither."""
    for uid in ("user-a", "user-b"):
        create_user(uid, email=f"{uid}@test.com")
        with _pg() as conn:
            conn.cursor().execute("DELETE FROM user_segments WHERE user_id = %s", (uid,))
    create_user_segment("user-a", "other-website", None, "otp", utm_medium="email",
                        utm_term="highlights", referrer_host="some-blog.example")
    create_user_segment("user-b", "direct", None, "otp")
    for uid in ("user-a", "user-b"):
        _acquired(uid)
    return client


@pytest.mark.parametrize("by,value", [
    ("utm_medium", "email"), ("utm_term", "highlights"), ("referrer_host", "some-blog.example")])
def test_campaigns_group_by_medium_term_and_referring_website(seeded, by, value):
    r = seeded.get("/api/admin/analytics/channels",
                   params={"by": by, "from": DAY, "to": DAY}, headers=_auth())
    assert r.status_code == 200, r.text
    assert {row[by]: row["signups"] for row in r.json()["channels"]} == {value: 1, "unknown": 1}


# --- AC5: migration ----------------------------------------------------------

def test_migration_adds_the_column_idempotently_and_keeps_rows(pg_conn):
    import os

    from app.migrations.postgres import MIGRATIONS
    from app.services.pg import _SCHEMA_DDL

    segments_ddl = _SCHEMA_DDL.split("CREATE TABLE IF NOT EXISTS user_segments")[1]
    assert "referrer_host TEXT" in segments_ddl.split("idx_segments_acquired")[0]
    migration = next((m for m in MIGRATIONS if "user_segments.referrer_host" in m.description), None)
    assert migration is not None, "no migration adds user_segments.referrer_host"

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:  # one transaction, rolled back: the shared dev DB keeps its column
        cur = conn.cursor()
        cur.execute("ALTER TABLE user_segments DROP COLUMN IF EXISTS referrer_host")
        cur.execute("INSERT INTO users (user_id, email) VALUES ('t16900-legacy', 't16900-legacy@test.local')")
        cur.execute("INSERT INTO user_segments (user_id, origin, signup_method) "
                    "VALUES ('t16900-legacy', 'organic', 'otp')")
        migration.up(conn)
        migration.up(conn)
        cur.execute("SELECT data_type FROM information_schema.columns "
                    "WHERE table_name = 'user_segments' AND column_name = 'referrer_host'")
        assert cur.fetchall() == [("text",)]
        cur.execute("SELECT origin, referrer_host FROM user_segments WHERE user_id = 't16900-legacy'")
        assert cur.fetchall() == [("organic", None)]
    finally:
        conn.rollback()
        conn.close()


def test_signup_succeeds_before_the_migration(pg_conn, caplog):
    """Migration window: the segment lands without its referrer_host and the gap is logged."""
    import app.analytics as analytics

    create_user("user-rh", email="rh@test.com")
    register_test_user_ids("user-rh")
    hidden = "referrer_host_t16900_hidden"
    with _pg() as conn:
        conn.cursor().execute(f"ALTER TABLE user_segments RENAME COLUMN referrer_host TO {hidden}")
    try:
        analytics._referrer_host_column_present = False
        with caplog.at_level("ERROR", logger="app.analytics"):
            create_user_segment("user-rh", "direct", None, "otp", referrer_host="x.example")
        with _pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT origin FROM user_segments WHERE user_id = 'user-rh'")
            assert cur.fetchone() == {"origin": "direct"}
        assert any("referrer_host" in r.getMessage() for r in caplog.records if r.levelname == "ERROR")
    finally:
        with _pg() as conn:
            conn.cursor().execute(f"ALTER TABLE user_segments RENAME COLUMN {hidden} TO referrer_host")
        analytics._referrer_host_column_present = False
