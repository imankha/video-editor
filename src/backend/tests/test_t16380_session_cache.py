"""
T16380: signed-in requests skip the repeated session lookup.

validate_session remembers each valid session in process memory for a short
time, so a burst of requests carrying the same rb_session cookie asks Postgres
once. Every path that ends or changes a session must clear the remembered entry
at once, and an entry is never served past the session's own expiry or its
impersonation time limit.
"""

import logging
import os
import re
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.services import auth_db

USER_ID = "t16380-user"
ADMIN_ID = "t16380-admin"
ADMIN_EMAIL = "t16380-admin@example.com"


@pytest.fixture()
def users(pg_conn):
    from tests.conftest import register_test_user_ids
    register_test_user_ids(USER_ID, ADMIN_ID)
    auth_db.create_user(USER_ID, email="t16380@example.com")
    auth_db.create_user(ADMIN_ID, email=ADMIN_EMAIL)
    with auth_db.get_auth_db() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES (%s) ON CONFLICT DO NOTHING", (ADMIN_EMAIL,)
        )
    yield
    with auth_db.get_auth_db() as conn:
        conn.cursor().execute("DELETE FROM admin_users WHERE email = %s", (ADMIN_EMAIL,))


@pytest.fixture()
def client(users, tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def lookups(monkeypatch):
    """Count the Postgres session lookups validate_session makes."""
    calls = []
    real = auth_db.get_auth_db

    def counting():
        calls.append(1)
        return real()

    monkeypatch.setattr(auth_db, "get_auth_db", counting)
    return calls


def _assert_remembered(session_id, lookups):
    """The session is now answered from memory: no Postgres round trip."""
    before = len(lookups)
    assert auth_db.validate_session(session_id) is not None
    assert len(lookups) == before, "validate_session went to Postgres for a remembered session"


def test_c1_burst_of_twelve_asks_postgres_once(users, lookups):
    sid = auth_db.create_session(USER_ID)
    lookups.clear()
    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(auth_db.validate_session, [sid] * 12))
    assert all(r and r["user_id"] == USER_ID for r in results)
    assert len(lookups) == 1, f"12 concurrent validations made {len(lookups)} Postgres lookups"


def test_c1_middleware_second_request_skips_postgres(client, lookups):
    sid = auth_db.create_session(USER_ID)
    client.cookies.set("rb_session", sid)
    assert client.get("/api/auth/me").status_code == 200
    lookups.clear()
    with patch.object(auth_db, "update_last_seen"):
        assert client.get("/api/version").status_code == 200
    assert len(lookups) == 0, "a repeat request with the same cookie asked Postgres again"


POSTGRES_LATENCY_S = 0.4  # added to every Postgres session lookup in the burst test
BURST_LIMIT_S = 0.5


@pytest.fixture()
def server(users, tmp_path):
    """The app served by a real uvicorn server, as in production (T16400 pattern)."""
    import uvicorn

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch.dict(os.environ, {"APP_ENV": "production"}):
        from app.main import app
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        srv = uvicorn.Server(uvicorn.Config(
            app, host="127.0.0.1", port=port, lifespan="off", log_level="warning",
        ))
        thread = threading.Thread(target=srv.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 10
        while not srv.started and time.monotonic() < deadline:
            time.sleep(0.05)
        yield f"http://127.0.0.1:{port}"
        srv.should_exit = True
        thread.join(30)


def test_c1_burst_of_twelve_signed_in_requests_each_under_half_a_second(
    server, monkeypatch, caplog
):
    """12 simultaneous signed-in GETs to a do-nothing endpoint on a real server,
    with every Postgres session lookup slowed: each answers in under 0.5 s and the
    timing log shows the session check at 0 ms after the first request."""
    import httpx

    real = auth_db.get_auth_db

    def slow_lookup():
        time.sleep(POSTGRES_LATENCY_S)
        return real()

    sid = auth_db.create_session(USER_ID)
    monkeypatch.setattr(auth_db, "get_auth_db", slow_lookup)
    caplog.set_level(logging.INFO, logger="app.middleware.db_sync")
    cookies = {"rb_session": sid}

    with httpx.Client(base_url=server, cookies=cookies, timeout=30) as c:
        assert c.get("/api/auth/me").status_code == 200  # the first request
    caplog.clear()

    barrier = threading.Barrier(12)

    def one(_):
        with httpx.Client(base_url=server, cookies=cookies, timeout=30) as c:
            barrier.wait()
            t0 = time.monotonic()
            r = c.get("/api/version")
            return r.status_code, time.monotonic() - t0

    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(one, range(12)))

    assert [code for code, _ in results] == [200] * 12
    slow = [round(t, 2) for _, t in results if t >= BURST_LIMIT_S]
    assert not slow, f"requests over {BURST_LIMIT_S}s: {slow} (all: {[round(t, 2) for _, t in results]})"

    deadline = time.monotonic() + 5
    while True:
        timings = [m for m in caplog.messages
                   if m.startswith("[REQ_TIMING] GET /api/version") and f"user={USER_ID}" in m]
        if len(timings) >= 12 or time.monotonic() > deadline:
            break
        time.sleep(0.05)
    assert len(timings) == 12, f"expected 12 timing lines, got {len(timings)}"
    auth_ms = [int(re.search(r"auth_ms=(\d+)", m).group(1)) for m in timings]
    assert auth_ms == [0] * 12, f"session check ms after the first request: {auth_ms}"


def test_c2_logout_refuses_old_cookie_at_once(client, lookups):
    sid = auth_db.create_session(USER_ID)
    client.cookies.set("rb_session", sid)
    assert client.get("/api/auth/me").status_code == 200
    _assert_remembered(sid, lookups)

    assert client.post("/api/auth/logout").status_code == 200
    client.cookies.set("rb_session", sid)
    assert client.get("/api/auth/me").status_code == 401


def test_c3_ending_a_users_sessions_refuses_next_request(client, lookups):
    sid = auth_db.create_session(USER_ID)
    assert auth_db.validate_session(sid) is not None
    _assert_remembered(sid, lookups)

    r = client.post(f"/api/auth/invalidate-sessions/{USER_ID}")
    assert r.status_code == 200, r.text
    assert auth_db.validate_session(sid) is None
    client.cookies.set("rb_session", sid)
    assert client.get("/api/auth/me").status_code == 401


def test_c4_impersonation_time_limit_refuses_and_audits(users, lookups):
    sid = auth_db.create_impersonation_session(USER_ID, ADMIN_ID, ttl_minutes=2 / 60)
    assert auth_db.validate_session(sid)["impersonator_user_id"] == ADMIN_ID
    _assert_remembered(sid, lookups)

    time.sleep(2.5)
    assert auth_db.validate_session(sid) is None
    with auth_db.get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM impersonation_audit WHERE action = 'expire' AND target_user_id = %s",
            (USER_ID,),
        )
        assert cur.fetchone() is not None, "no 'expire' audit row for the timed-out impersonation"


def test_c5_session_expiring_while_remembered_is_refused(users, lookups):
    sid = auth_db.create_session(USER_ID)
    with auth_db.get_auth_db() as conn:
        conn.cursor().execute(
            "UPDATE sessions SET expires_at = %s WHERE session_id = %s",
            (datetime.now(UTC) + timedelta(seconds=2), sid),
        )
    assert auth_db.validate_session(sid) is not None
    _assert_remembered(sid, lookups)

    time.sleep(2.5)
    assert auth_db.validate_session(sid) is None


def test_terms_acceptance_is_seen_on_the_next_request(client, lookups):
    sid = auth_db.create_session(USER_ID)
    client.cookies.set("rb_session", sid)
    assert client.get("/api/auth/me").json()["needs_terms_acceptance"] is True
    _assert_remembered(sid, lookups)

    assert client.post("/api/auth/accept-terms", json={}).status_code == 200
    assert client.get("/api/auth/me").json()["needs_terms_acceptance"] is False


def test_returned_dict_is_a_copy(users):
    sid = auth_db.create_session(USER_ID)
    auth_db.validate_session(sid)["user_id"] = "tampered"
    assert auth_db.validate_session(sid)["user_id"] == USER_ID
