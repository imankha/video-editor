"""T14180: per-IP limits on OTP sends and account creation, backed by Postgres.

The client IP is Fly's `Fly-Client-IP` header (the browser calls *.fly.dev
directly; Fly's edge overwrites the header, so a client cannot spoof it).
Driven through the real routes; only the outbound emails and Google token
verification are stubbed.
"""

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

_EMAIL_DOMAIN = "@t14180.test"
_IP_PREFIX = "t14180-"
# The spec'd limits (app.routers.auth module constants must match).
OTP_SENDS_PER_IP_PER_HOUR = 20
SIGNUPS_PER_IP_PER_DAY = 10


def _cleanup(cur):
    cur.execute("SELECT user_id FROM users WHERE email LIKE %s", ("%" + _EMAIL_DOMAIN,))
    ids = [r["user_id"] for r in cur.fetchall()]
    if ids:
        cur.execute("DELETE FROM sessions WHERE user_id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM user_segments WHERE user_id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM credit_transactions WHERE user_id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM credits WHERE user_id = ANY(%s)", (ids,))
        cur.execute("DELETE FROM users WHERE user_id = ANY(%s)", (ids,))
    cur.execute("DELETE FROM otp_codes WHERE email LIKE %s", ("%" + _EMAIL_DOMAIN,))
    cur.execute("SELECT to_regclass('ip_rate_events') AS t")
    if cur.fetchone()["t"]:
        cur.execute("DELETE FROM ip_rate_events WHERE ip LIKE %s", (_IP_PREFIX + "%",))


@pytest.fixture()
def client(pg_conn, tmp_path):
    from app.services.pg import get_pg

    with get_pg() as conn:
        _cleanup(conn.cursor())
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.routers.auth._send_welcome_email", new=AsyncMock()), \
         patch("app.services.email.send_otp_email", new=AsyncMock()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)
    with get_pg() as conn:
        _cleanup(conn.cursor())


def _ip() -> str:
    return _IP_PREFIX + uuid.uuid4().hex[:12]


def _email() -> str:
    return uuid.uuid4().hex[:12] + _EMAIL_DOMAIN


def _send_otp(client, ip, email=None):
    return client.post(
        "/api/auth/send-otp",
        json={"email": email or _email()},
        headers={"Fly-Client-IP": ip},
    )


def _verify_new(client, ip, email=None):
    from app.services.pg import get_pg

    email = email or _email()
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO otp_codes (email, code, expires_at) VALUES (%s, %s, now() + interval '10 min')",
            (email, "123456"),
        )
    r = client.post(
        "/api/auth/verify-otp",
        json={"email": email, "code": "123456"},
        headers={"Fly-Client-IP": ip},
    )
    client.cookies.clear()
    return r, email


def _user_exists(email) -> bool:
    from app.services.auth_db import get_user_by_email

    return get_user_by_email(email) is not None


# --- C1: the Nth OTP request from one IP within the window is refused --------

def test_otp_send_refused_with_429_after_ip_limit(client):

    ip = _ip()
    for _ in range(OTP_SENDS_PER_IP_PER_HOUR):
        r = _send_otp(client, ip)
        assert r.status_code == 200, r.text
    refused = _send_otp(client, ip)
    assert refused.status_code == 429
    assert "network" in refused.json()["detail"].lower()


def test_otp_send_limit_does_not_affect_other_ips(client):

    busy = _ip()
    for _ in range(OTP_SENDS_PER_IP_PER_HOUR):
        assert _send_otp(client, busy).status_code == 200
    assert _send_otp(client, busy).status_code == 429
    assert _send_otp(client, _ip()).status_code == 200


def test_refused_otp_send_writes_no_code_and_sends_no_email(client):
    from app.services.pg import get_pg

    ip = _ip()
    for _ in range(OTP_SENDS_PER_IP_PER_HOUR):
        _send_otp(client, ip)
    email = _email()
    with patch("app.services.email.send_otp_email", new=AsyncMock()) as sender:
        assert _send_otp(client, ip, email).status_code == 429
        sender.assert_not_called()
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) AS n FROM otp_codes WHERE email = %s", (email,))
        assert cur.fetchone()["n"] == 0


# --- C2: the limit survives a process restart ---------------------------------

def test_otp_limit_is_read_from_postgres_not_process_memory(client):
    """Events recorded by a previous process (rows already in Postgres, nothing
    in this process's memory) still count against the IP."""
    from app.services.pg import get_pg

    ip = _ip()
    with get_pg() as conn:
        cur = conn.cursor()
        for _ in range(OTP_SENDS_PER_IP_PER_HOUR):
            cur.execute(
                "INSERT INTO ip_rate_events (action, ip, created_at) VALUES ('otp_send', %s, now() - interval '5 min')",
                (ip,),
            )
    assert _send_otp(client, ip).status_code == 429


def test_otp_events_outside_window_do_not_count(client):
    from app.services.pg import get_pg

    ip = _ip()
    with get_pg() as conn:
        cur = conn.cursor()
        for _ in range(OTP_SENDS_PER_IP_PER_HOUR):
            cur.execute(
                "INSERT INTO ip_rate_events (action, ip, created_at) VALUES ('otp_send', %s, now() - interval '61 min')",
                (ip,),
            )
    assert _send_otp(client, ip).status_code == 200


# --- Account creation (free credits) is limited per IP -----------------------

def test_otp_signup_refused_after_ip_signup_limit(client):

    ip = _ip()
    for _ in range(SIGNUPS_PER_IP_PER_DAY):
        r, _ = _verify_new(client, ip)
        assert r.status_code == 200, r.text
    r, email = _verify_new(client, ip)
    assert r.status_code == 429
    assert not _user_exists(email)
    # A fresh IP can still sign up.
    r, email = _verify_new(client, _ip())
    assert r.status_code == 200
    assert _user_exists(email)


def test_existing_user_login_not_blocked_by_signup_limit(client):

    ip = _ip()
    first_email = None
    for _ in range(SIGNUPS_PER_IP_PER_DAY):
        r, email = _verify_new(client, ip)
        first_email = first_email or email
        assert r.status_code == 200
    r, _ = _verify_new(client, ip, email=first_email)
    assert r.status_code == 200, r.text


def test_google_signup_refused_after_ip_signup_limit(client):

    ip = _ip()
    for _ in range(SIGNUPS_PER_IP_PER_DAY):
        r, _ = _verify_new(client, ip)
        assert r.status_code == 200
    email = _email()
    token = {"email": email, "sub": "g-" + uuid.uuid4().hex}
    with patch("app.routers.auth._verify_google_token", new=AsyncMock(return_value=token)):
        r = client.post("/api/auth/google", json={"token": "x"}, headers={"Fly-Client-IP": ip})
    assert r.status_code == 429
    assert not _user_exists(email)


# --- Schema -------------------------------------------------------------------

def test_postgres_migration_and_fresh_ddl_create_ip_rate_events():
    from app.migrations.postgres import MIGRATIONS
    from app.services.pg import _SCHEMA_DDL

    assert "CREATE TABLE IF NOT EXISTS ip_rate_events" in _SCHEMA_DDL
    v041 = [m for m in MIGRATIONS if m.version == 41]
    assert v041, "postgres v041 migration missing"


def test_module_limits_match_spec():
    from app.routers import auth

    assert getattr(auth, "_MAX_OTP_SENDS_PER_IP_PER_HOUR", None) == OTP_SENDS_PER_IP_PER_HOUR
    assert getattr(auth, "_MAX_SIGNUPS_PER_IP_PER_DAY", None) == SIGNUPS_PER_IP_PER_DAY
