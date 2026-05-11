"""T1190: Session & Machine Pinning via Fly.io Replay Headers.

Tests for:
- fly_machine_id cookie set on authenticated responses
- fly-replay header returned on machine mismatch
- Circuit-breaker: fallback when target machine unavailable
- Single active session enforcement on login
- WebSocket ASGI middleware replay
"""

import os
import sqlite3
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient


MACHINE_A = "e784079a011e86"
MACHINE_B = "d286530f900128"


@pytest.fixture()
def isolated_auth_db(tmp_path):
    """Fresh auth.sqlite for each test."""
    db_path = tmp_path / "auth.sqlite"
    with patch("app.services.auth_db.AUTH_DB_PATH", db_path), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True), \
         patch("app.services.auth_db.persist_session_to_r2"), \
         patch("app.services.auth_db.delete_session_from_r2"):
        from app.services.auth_db import init_auth_db, create_user, _session_cache, _session_cache_lock
        init_auth_db()
        create_user("test-user", email="test@example.com")
        with _session_cache_lock:
            _session_cache.clear()
        yield db_path


@pytest.fixture()
def client_on_machine_a(isolated_auth_db, tmp_path):
    """TestClient where the server thinks it's Machine A."""
    with patch("app.services.auth_db.AUTH_DB_PATH", isolated_auth_db), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True), \
         patch("app.services.auth_db.persist_session_to_r2"), \
         patch("app.services.auth_db.delete_session_from_r2"), \
         patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch.dict(os.environ, {"FLY_MACHINE_ID": MACHINE_A}), \
         patch("app.middleware.db_sync.FLY_MACHINE_ID", MACHINE_A, create=True):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def client_no_fly(isolated_auth_db, tmp_path):
    """TestClient with no FLY_MACHINE_ID (local dev)."""
    with patch("app.services.auth_db.AUTH_DB_PATH", isolated_auth_db), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True), \
         patch("app.services.auth_db.persist_session_to_r2"), \
         patch("app.services.auth_db.delete_session_from_r2"), \
         patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.middleware.db_sync.FLY_MACHINE_ID", "", create=True):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# 1. Cookie setting
# ---------------------------------------------------------------------------

class TestMachineCookieSetting:
    """fly_machine_id cookie should be set on authenticated responses."""

    def test_cookie_set_on_first_authenticated_request(self, client_on_machine_a):
        """First request with no fly_machine_id cookie gets one set in response."""
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
        )
        assert r.cookies.get("fly_machine_id") == MACHINE_A

    def test_no_cookie_when_no_fly_machine_id(self, client_no_fly):
        """In local dev (no FLY_MACHINE_ID), no fly_machine_id cookie is set."""
        r = client_no_fly.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
        )
        assert "fly_machine_id" not in r.cookies

    def test_cookie_not_reset_when_already_matching(self, client_on_machine_a):
        """When cookie matches current machine, no Set-Cookie header needed."""
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
            cookies={"fly_machine_id": MACHINE_A},
        )
        assert r.status_code != 400
        cookie_header = r.headers.get("set-cookie", "")
        assert "fly_machine_id" not in cookie_header


# ---------------------------------------------------------------------------
# 2. Fly-replay on mismatch
# ---------------------------------------------------------------------------

class TestFlyReplay:
    """Requests with mismatched fly_machine_id should get fly-replay response."""

    def test_replay_on_cookie_mismatch(self, client_on_machine_a):
        """Cookie says Machine B but we're Machine A -> fly-replay header."""
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
            cookies={"fly_machine_id": MACHINE_B},
        )
        assert r.headers.get("fly-replay") == f"instance={MACHINE_B}"

    def test_replay_is_short_circuit(self, client_on_machine_a):
        """Replayed response should not run any handler logic (no auth, no DB)."""
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
            cookies={"fly_machine_id": MACHINE_B},
        )
        assert "fly-replay" in r.headers
        assert r.status_code == 200

    def test_no_replay_when_cookie_matches(self, client_on_machine_a):
        """When cookie matches current machine, no fly-replay header."""
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
            cookies={"fly_machine_id": MACHINE_A},
        )
        assert "fly-replay" not in r.headers

    def test_no_replay_when_no_cookie(self, client_on_machine_a):
        """First request (no cookie) should not trigger replay."""
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
        )
        assert "fly-replay" not in r.headers

    def test_replay_works_for_post_requests(self, client_on_machine_a):
        """POST requests also get replayed on machine mismatch."""
        r = client_on_machine_a.post(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
            cookies={"fly_machine_id": MACHINE_B},
        )
        assert r.headers.get("fly-replay") == f"instance={MACHINE_B}"


# ---------------------------------------------------------------------------
# 3. Circuit-breaker (target machine unavailable)
# ---------------------------------------------------------------------------

class TestCircuitBreaker:
    """When fly-replay-src is present with mismatch, handle locally."""

    def test_circuit_breaker_clears_stale_cookie(self, client_on_machine_a):
        """Replayed request arriving on wrong machine (target dead) should
        clear old cookie and set new one for current machine."""
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={
                "X-User-ID": "test-user",
                "fly-replay-src": f"instance={MACHINE_B};region=lax;t=1234",
            },
            cookies={"fly_machine_id": MACHINE_B},
        )
        assert "fly-replay" not in r.headers
        assert r.cookies.get("fly_machine_id") == MACHINE_A

    def test_circuit_breaker_processes_request_normally(self, client_on_machine_a):
        """Circuit-breaker should process the request, not reject it."""
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={
                "X-User-ID": "test-user",
                "fly-replay-src": f"instance={MACHINE_B};region=lax;t=1234",
            },
            cookies={"fly_machine_id": MACHINE_B},
        )
        assert r.status_code != 401


# ---------------------------------------------------------------------------
# 4. Single active session enforcement
# ---------------------------------------------------------------------------

class TestSingleSession:
    """New login should invalidate all existing sessions."""

    def test_login_invalidates_previous_sessions(self, isolated_auth_db):
        """Creating a new session via _issue_session_cookie invalidates old ones."""
        from app.services.auth_db import (
            create_session, validate_session, invalidate_user_sessions,
            _session_cache, _session_cache_lock,
        )
        old_sid = create_session("test-user")
        assert validate_session(old_sid) is not None

        invalidate_user_sessions("test-user")
        new_sid = create_session("test-user")

        with _session_cache_lock:
            _session_cache.clear()

        assert validate_session(old_sid) is None
        assert validate_session(new_sid) is not None

    def test_login_endpoint_enforces_single_session(self, client_on_machine_a, isolated_auth_db):
        """The login flow should invalidate old sessions before creating new one."""
        from app.services.auth_db import create_session, validate_session, _session_cache, _session_cache_lock

        old_sid = create_session("test-user")
        assert validate_session(old_sid) is not None

        with patch("app.routers.auth._verify_google_token", return_value={
            "email": "test@example.com",
            "sub": "google-id-123",
        }):
            r = client_on_machine_a.post(
                "/api/auth/google",
                json={"token": "fake-token"},
            )
        assert r.status_code == 200

        with _session_cache_lock:
            _session_cache.clear()

        assert validate_session(old_sid) is None


# ---------------------------------------------------------------------------
# 5. Cookie on login
# ---------------------------------------------------------------------------

class TestCookieOnLogin:
    """Login response should include fly_machine_id cookie alongside rb_session."""

    def test_google_login_sets_machine_cookie(self, client_on_machine_a, isolated_auth_db):
        """Google auth response includes fly_machine_id cookie."""
        with patch("app.routers.auth._verify_google_token", return_value={
            "email": "test@example.com",
            "sub": "google-id-123",
        }):
            r = client_on_machine_a.post(
                "/api/auth/google",
                json={"token": "fake-token"},
            )
        assert r.status_code == 200
        assert "rb_session" in r.cookies
        assert r.cookies.get("fly_machine_id") == MACHINE_A

    def test_login_no_machine_cookie_in_local_dev(self, client_no_fly, isolated_auth_db):
        """No fly_machine_id cookie when FLY_MACHINE_ID is not set."""
        with patch("app.routers.auth._verify_google_token", return_value={
            "email": "test@example.com",
            "sub": "google-id-123",
        }):
            r = client_no_fly.post(
                "/api/auth/google",
                json={"token": "fake-token"},
            )
        assert r.status_code == 200
        assert "rb_session" in r.cookies
        assert "fly_machine_id" not in r.cookies


# ---------------------------------------------------------------------------
# 6. Export pinning hack removal
# ---------------------------------------------------------------------------

class TestExportPinningRemoved:
    """The old export pinning hack (machineId via WebSocket) should be removed."""

    def test_websocket_does_not_send_machine_id(self, client_on_machine_a):
        """WebSocket should not send a connected+machineId message on connect.
        We verify by sending a ping; the first response should be pong, not
        a connected message."""
        with client_on_machine_a.websocket_connect("/ws/export/test-export-123") as ws:
            ws.send_text("ping")
            response = ws.receive_text()
            assert response == "pong"


# ---------------------------------------------------------------------------
# 7. Health/auth paths still work
# ---------------------------------------------------------------------------

class TestAllowlistedPaths:
    """Allowlisted paths should still function with replay logic."""

    def test_health_endpoint_unaffected(self, client_on_machine_a):
        """Health check should work regardless of cookie state."""
        r = client_on_machine_a.get("/api/health")
        assert r.status_code == 200

    def test_health_with_stale_cookie_still_replays(self, client_on_machine_a):
        """Even health checks replay when cookie mismatches -- replay is
        path-agnostic to maintain simplicity."""
        r = client_on_machine_a.get(
            "/api/health",
            cookies={"fly_machine_id": MACHINE_B},
        )
        assert r.headers.get("fly-replay") == f"instance={MACHINE_B}"
