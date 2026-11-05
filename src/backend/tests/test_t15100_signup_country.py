"""T15100: country on the sign-up row. Rows sit on a fixed old acquisition date and are
read through that one-day window, so other rows in the shared dev database cannot change
the counts. The stored value is read through to_jsonb so a missing column is an assertion
failure, not a SQL error."""

import os
from datetime import UTC, datetime
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


def _stored_country(user_id):
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT to_jsonb(s) ->> 'country' AS country FROM user_segments s "
                    "WHERE s.user_id = %s", (user_id,))
        return cur.fetchone()["country"]


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


@pytest.fixture()
def seeded(client):
    """user-a US, user-b DE, user-c signed up with no country."""
    for uid, country in (("user-a", "US"), ("user-b", "DE"), ("user-c", None)):
        create_user(uid, email=f"{uid}@test.com")
        with _pg() as conn:
            conn.cursor().execute("DELETE FROM user_segments WHERE user_id = %s", (uid,))
        create_user_segment(uid, "organic", None, "otp", country=country)
        _acquired(uid)
    return client


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

def test_otp_signup_stores_country(client):
    assert _stored_country(_otp_signup(client, "t15100-otp@test.local", country="US")) == "US"


def test_google_signup_stores_country(client):
    assert _stored_country(_google_signup(client, "t15100-g@test.local", country="DE")) == "DE"


@pytest.mark.parametrize("bad", ["us", "USA", "X1", "T1", "XX", "", "US\n"])
def test_invalid_country_is_stored_as_null(client, bad):
    """T1 is Cloudflare's Tor marker and XX its no-data marker: XX fits the format but
    names no country, so keeping it would read as a place."""
    user_id = _otp_signup(client, f"t15100-bad-{ord(bad[-1]) if bad else 0}@test.local", country=bad)
    assert _stored_country(user_id) is None


def test_signup_without_country_stores_null(client):
    assert _stored_country(_otp_signup(client, "t15100-none@test.local")) is None


def test_signup_succeeds_before_the_migration(pg_conn, caplog):
    """Migration window: the segment lands without its country and the gap is logged."""
    import app.analytics as analytics

    create_user("user-c", email="c@test.com")
    hidden = "country_t15100_hidden"
    with _pg() as conn:
        conn.cursor().execute(f"ALTER TABLE user_segments RENAME COLUMN country TO {hidden}")
    try:
        analytics._country_column_present = False
        with caplog.at_level("ERROR", logger="app.analytics"):
            create_user_segment("user-c", "organic", None, "otp", country="US")
        with _pg() as conn:
            cur = conn.cursor()
            cur.execute("SELECT origin FROM user_segments WHERE user_id = 'user-c'")
            assert cur.fetchone() == {"origin": "organic"}
        assert any("country" in r.getMessage() for r in caplog.records if r.levelname == "ERROR")
    finally:
        with _pg() as conn:
            conn.cursor().execute(f"ALTER TABLE user_segments RENAME COLUMN {hidden} TO country")
        analytics._country_column_present = False


# --- Migration ---------------------------------------------------------------

def test_migration_adds_the_column_and_is_idempotent(pg_conn):
    from app.migrations.postgres import MIGRATIONS
    from app.services.pg import _SCHEMA_DDL

    segments_ddl = _SCHEMA_DDL.split("CREATE TABLE IF NOT EXISTS user_segments")[1]
    assert "country TEXT" in segments_ddl.split("idx_segments_acquired")[0]
    migration = next((m for m in MIGRATIONS if "user_segments.country" in m.description), None)
    assert migration is not None, "no migration adds user_segments.country"

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    try:  # one transaction, rolled back: the shared dev DB keeps its column
        cur = conn.cursor()
        cur.execute("ALTER TABLE user_segments DROP COLUMN IF EXISTS country")
        migration.up(conn)
        migration.up(conn)
        cur.execute("SELECT data_type FROM information_schema.columns "
                    "WHERE table_name = 'user_segments' AND column_name = 'country'")
        assert cur.fetchall() == [("text",)]
    finally:
        conn.rollback()
        conn.close()


# --- Admin reads -------------------------------------------------------------

def test_channels_group_by_country_with_unknown_row(seeded):
    r = seeded.get("/api/admin/analytics/channels",
                   params={"from": DAY, "to": DAY, "by": "country"}, headers=_auth())
    assert r.status_code == 200, r.text
    assert {c["country"]: c["signups"] for c in r.json()["channels"]} == {"US": 1, "DE": 1, "unknown": 1}


def test_step_inspector_breaks_down_by_country_with_unknown_row(seeded):
    with _pg() as conn:
        cur = conn.cursor()
        for uid in ("user-a", "user-b", "user-c"):
            cur.execute("INSERT INTO user_actions (user_id, action, platform) "
                        "VALUES (%s, 'session_started', 'desktop')", (uid,))
    r = seeded.get("/api/admin/analytics/journey/step/started",
                   params={"by": "country", "from": DAY, "to": DAY}, headers=_auth())
    assert r.status_code == 200, r.text
    assert {b["key"]: b["reached"] for b in r.json()["breakdown"]} == {"US": 1, "DE": 1, "unknown": 1}


def _listed(client, **params):
    r = client.get("/api/admin/users", headers=_auth(),
                   params={"acquired_from": DAY, "acquired_to": DAY, "exclude_test": False, **params})
    assert r.status_code == 200, r.text
    return {u["user_id"] for u in r.json()["users"]}


def test_users_filter_by_country(seeded):
    assert _listed(seeded) == {"user-a", "user-b", "user-c"}
    assert _listed(seeded, country="US") == {"user-a"}


def test_users_filter_unknown_matches_the_unknown_row(seeded):
    assert _listed(seeded, country="unknown") == {"user-c"}


def test_users_filter_rejects_a_malformed_country(seeded):
    r = seeded.get("/api/admin/users", params={"country": "usa"}, headers=_auth())
    assert r.status_code == 422


def test_pulse_follows_the_country_filter(seeded):
    """The Users filter also narrows the pulse cards, or the chip would claim a filter the
    cards ignore."""
    today = datetime.now(UTC).date().isoformat()
    for uid in ("user-a", "user-b"):
        _acquired(uid, today)

    def signups(**params):
        r = seeded.get("/api/admin/analytics/pulse", headers=_auth(),
                       params={"acquired_from": today, "acquired_to": today, "exclude_test": False, **params})
        assert r.status_code == 200, r.text
        return r.json()["cards"]["signups"]["today"]

    assert signups(country="DE") == 1
    assert signups(country="BR") == 0


# --- Country as a segment filter on every analytics read ---------------------

COUNTRY_CASES = [("US", "user-a"), ("DE", "user-b"), ("unknown", "user-c")]


def _get(client, path, **params):
    r = client.get(path, headers=_auth(), params={"from": DAY, "to": DAY, **params})
    assert r.status_code == 200, r.text
    return r.json()


def _journey_signed_up(client, **params):
    nodes = _get(client, "/api/admin/analytics/journey", **params)["nodes"]
    return next(n for n in nodes if n["key"] == "signed_up")["reached"]


def _pay(user_id, cents):
    with _pg() as conn:
        conn.cursor().execute(
            """INSERT INTO payments (user_id, kind, amount_cents, currency,
                                     stripe_object_id, occurred_at, source)
               VALUES (%s, 'purchase', %s, 'usd', %s, now(), 'backfill')""",
            (user_id, cents, f"pi_t15100_{user_id}"))


@pytest.mark.parametrize("country,_user", COUNTRY_CASES)
def test_journey_signed_up_follows_country(seeded, country, _user):
    assert _journey_signed_up(seeded) == 3
    assert _journey_signed_up(seeded, country=country) == 1


def test_journey_is_empty_for_a_country_nobody_signed_up_from(seeded):
    assert _journey_signed_up(seeded, country="BR") == 0


@pytest.mark.parametrize("country,user", COUNTRY_CASES)
def test_funnel_follows_country(seeded, country, user):
    from app.analytics import FLOW_EVENTS, FUNNEL_STEPS

    step = FUNNEL_STEPS[0]
    with _pg() as conn:
        conn.cursor().execute("INSERT INTO user_actions (user_id, action, platform) "
                              "VALUES (%s, %s, 'desktop')", (user, step))
    key = FLOW_EVENTS[step]["label"].lower().replace(" ", "_")

    everyone = _get(seeded, "/api/admin/analytics/funnel")["funnel"][0]
    assert everyone["signed_up"] == 3

    totals = _get(seeded, "/api/admin/analytics/funnel", country=country)["funnel"][0]
    assert (totals["signed_up"], totals[key]) == (1, 1)
    others = next(c for c, u in COUNTRY_CASES if u != user)
    assert _get(seeded, "/api/admin/analytics/funnel", country=others)["funnel"][0][key] == 0


@pytest.mark.parametrize("country,_user", COUNTRY_CASES)
def test_step_inspector_follows_country(seeded, country, _user):
    with _pg() as conn:
        cur = conn.cursor()
        for uid in ("user-a", "user-b", "user-c"):
            cur.execute("INSERT INTO user_actions (user_id, action, platform) "
                        "VALUES (%s, 'session_started', 'desktop')", (uid,))
    step = _get(seeded, "/api/admin/analytics/journey/step/started", by="platform", country=country)
    assert sum(b["reached"] for b in step["breakdown"]) == 1


@pytest.mark.parametrize("path,rows", [("channels", "channels"), ("cohorts", "cohorts"), ("builds", "builds")])
@pytest.mark.parametrize("country,_user", COUNTRY_CASES)
def test_dimension_tables_follow_country(seeded, path, rows, country, _user):
    url = f"/api/admin/analytics/{path}"
    assert sum(r["signups"] for r in _get(seeded, url)[rows]) == 3
    assert sum(r["signups"] for r in _get(seeded, url, country=country)[rows]) == 1


@pytest.mark.parametrize("path", ["channels", "cohorts", "builds"])
def test_unattributed_remainder_reconciles_within_the_country(seeded, path):
    """Other countries' revenue is out of scope, not unattributed."""
    _pay("user-a", 1000)
    _pay("user-b", 500)
    data = _get(seeded, f"/api/admin/analytics/{path}", country="US")
    assert data["unattributed_revenue_cents"] == 0


@pytest.mark.parametrize("path", [
    "journey", "funnel", "journey/step/started", "channels", "cohorts", "builds"])
def test_every_read_rejects_a_malformed_country(seeded, path):
    r = seeded.get(f"/api/admin/analytics/{path}", params={"country": "usa"}, headers=_auth())
    assert r.status_code == 422


def test_dashboard_carries_the_country(seeded):
    r = seeded.get("/api/admin/dashboard", params={"country": "BR", "exclude_test": False}, headers=_auth())
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["users"]["users"] == []
    assert data["channels"]["channels"] == []
    assert data["cohorts"]["cohorts"] == []


def test_dashboard_carries_the_selector_options_whatever_is_picked(seeded):
    """The options ride the one mount request (T8020) and ignore the picked country."""
    today = datetime.now(UTC).date().isoformat()
    _acquired("user-b", today)
    r = seeded.get("/api/admin/dashboard", params={"country": "US", "exclude_test": False}, headers=_auth())
    assert r.status_code == 200, r.text
    assert "DE" in r.json()["countries"]


# --- Selector options --------------------------------------------------------

def test_countries_lists_those_in_the_window_most_signups_first(seeded):
    create_user("regular-user", email="regular-user@test.com")
    with _pg() as conn:
        conn.cursor().execute("DELETE FROM user_segments WHERE user_id = 'regular-user'")
    create_user_segment("regular-user", "organic", None, "otp", country="DE")
    _acquired("regular-user")
    assert _get(seeded, "/api/admin/analytics/countries", exclude_test=False)["countries"] == ["DE", "US"]


def test_countries_leaves_out_other_windows(seeded):
    data = _get(seeded, "/api/admin/analytics/countries", **{"from": "2019-01-01", "to": "2019-01-02"})
    assert data["countries"] == []


def test_countries_survives_the_migration_window(seeded, caplog):
    """The selector loads on every admin page, so it must not 500 before v043 runs."""
    import app.analytics as analytics

    hidden = "country_t15100_hidden"
    with _pg() as conn:
        conn.cursor().execute(f"ALTER TABLE user_segments RENAME COLUMN country TO {hidden}")
    try:
        analytics._country_column_present = False
        with caplog.at_level("ERROR"):
            assert _get(seeded, "/api/admin/analytics/countries")["countries"] == []
        assert any("country" in r.getMessage() for r in caplog.records if r.levelname == "ERROR")
    finally:
        with _pg() as conn:
            conn.cursor().execute(f"ALTER TABLE user_segments RENAME COLUMN {hidden} TO country")
        analytics._country_column_present = False
