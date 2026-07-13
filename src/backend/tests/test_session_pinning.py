"""T1190: Session & Machine Pinning via Fly.io Replay Headers.
T2720: Post-Export R2 Sync Lock Timeout.

Tests for:
- fly_machine_id cookie set on authenticated responses
- fly-replay header returned on machine mismatch
- Circuit-breaker: fallback when target machine unavailable
- Single active session enforcement on login
- WebSocket ASGI middleware replay
- Cookie attribute consistency (samesite, secure, httponly)
- Sync lock timeout prevents 14s stall behind export worker
"""

import asyncio
import os
import sqlite3
import time
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient


MACHINE_A = "e784079a011e86"
MACHINE_B = "d286530f900128"


@pytest.fixture()
def isolated_auth_db(pg_conn):
    """Fresh Postgres for each test."""
    from app.services.auth_db import create_user
    create_user("test-user", email="test@example.com")
    yield


@pytest.fixture()
def client_on_machine_a(isolated_auth_db, tmp_path):
    """TestClient where the server thinks it's Machine A.

    Both machines are registered in _LIVE_MACHINES so the replay liveness
    gate treats Machine B as a healthy peer (replay fires) rather than a dead
    machine (circuit-breaker handles locally). The empty live set only happens
    at startup before the Fly machines API is polled.
    """
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch.dict(os.environ, {"FLY_MACHINE_ID": MACHINE_A}), \
         patch("app.middleware.db_sync.FLY_MACHINE_ID", MACHINE_A, create=True), \
         patch("app.middleware.db_sync._LIVE_MACHINES", {MACHINE_A, MACHINE_B}):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def client_no_fly(isolated_auth_db, tmp_path):
    """TestClient with no FLY_MACHINE_ID (local dev)."""
    with patch("app.database.USER_DATA_BASE", tmp_path), \
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
        client_on_machine_a.cookies.set("fly_machine_id", MACHINE_A)
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
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
        client_on_machine_a.cookies.set("fly_machine_id", MACHINE_B)
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
        )
        assert r.headers.get("fly-replay") == f"instance={MACHINE_B}"

    def test_replay_is_short_circuit(self, client_on_machine_a):
        """Replayed response should not run any handler logic (no auth, no DB)."""
        client_on_machine_a.cookies.set("fly_machine_id", MACHINE_B)
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
        )
        assert "fly-replay" in r.headers
        assert r.status_code == 200

    def test_no_replay_when_cookie_matches(self, client_on_machine_a):
        """When cookie matches current machine, no fly-replay header."""
        client_on_machine_a.cookies.set("fly_machine_id", MACHINE_A)
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
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
        client_on_machine_a.cookies.set("fly_machine_id", MACHINE_B)
        r = client_on_machine_a.post(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
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
        client_on_machine_a.cookies.set("fly_machine_id", MACHINE_B)
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={
                "X-User-ID": "test-user",
                "fly-replay-src": f"instance={MACHINE_B};region=lax;t=1234",
            },
        )
        assert "fly-replay" not in r.headers
        assert r.cookies.get("fly_machine_id") == MACHINE_A

    def test_circuit_breaker_processes_request_normally(self, client_on_machine_a):
        """Circuit-breaker should process the request, not reject it."""
        client_on_machine_a.cookies.set("fly_machine_id", MACHINE_B)
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={
                "X-User-ID": "test-user",
                "fly-replay-src": f"instance={MACHINE_B};region=lax;t=1234",
            },
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
        )
        old_sid = create_session("test-user")
        assert validate_session(old_sid) is not None

        invalidate_user_sessions("test-user")
        new_sid = create_session("test-user")

        assert validate_session(old_sid) is None
        assert validate_session(new_sid) is not None

    def test_login_endpoint_enforces_single_session(self, client_on_machine_a):
        """The login flow should invalidate old sessions before creating new one."""
        from app.services.auth_db import create_session, validate_session

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

        assert validate_session(old_sid) is None


# ---------------------------------------------------------------------------
# 5. Cookie on login
# ---------------------------------------------------------------------------

class TestCookieOnLogin:
    """Login response should include fly_machine_id cookie alongside rb_session."""

    def test_google_login_sets_machine_cookie(self, client_on_machine_a):
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

    def test_login_no_machine_cookie_in_local_dev(self, client_no_fly):
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
        client_on_machine_a.cookies.set("fly_machine_id", MACHINE_B)
        r = client_on_machine_a.get("/api/health")
        assert r.headers.get("fly-replay") == f"instance={MACHINE_B}"


# ---------------------------------------------------------------------------
# 8. WebSocket ASGI middleware (FlyReplayMiddleware) unit tests
# ---------------------------------------------------------------------------

def _make_ws_scope(cookies=None, headers=None):
    """Build a minimal ASGI WebSocket scope."""
    raw_headers = []
    if cookies:
        cookie_str = "; ".join(f"{k}={v}" for k, v in cookies.items())
        raw_headers.append((b"cookie", cookie_str.encode()))
    for name, val in (headers or {}).items():
        raw_headers.append((name.encode() if isinstance(name, str) else name,
                            val.encode() if isinstance(val, str) else val))
    return {"type": "websocket", "headers": raw_headers}


class TestFlyReplayMiddlewareASGI:
    """Direct ASGI-level tests for FlyReplayMiddleware."""

    def _run(self, coro):
        return asyncio.run(coro)

    def test_ws_mismatch_sends_replay(self):
        """WebSocket with mismatched cookie gets fly-replay rejection."""
        from app.middleware.fly_replay import FlyReplayMiddleware

        sent = []
        inner_called = False

        async def inner(scope, receive, send):
            nonlocal inner_called
            inner_called = True

        async def mock_send(msg):
            sent.append(msg)

        scope = _make_ws_scope(cookies={"fly_machine_id": MACHINE_B})
        mw = FlyReplayMiddleware(inner)
        # Machine B must be in the live set, otherwise the liveness gate treats
        # the cookie as stale and accepts the WS locally instead of replaying.
        with patch("app.middleware.fly_replay.FLY_MACHINE_ID", MACHINE_A), \
             patch("app.middleware.db_sync._LIVE_MACHINES", {MACHINE_A, MACHINE_B}):
            self._run(mw(scope, None, mock_send))

        assert not inner_called
        assert len(sent) == 2
        assert sent[0]["type"] == "websocket.http.response.start"
        assert sent[0]["status"] == 400
        replay_header = dict(sent[0]["headers"])
        assert replay_header[b"fly-replay"] == f"instance={MACHINE_B}".encode()
        assert sent[1]["type"] == "websocket.http.response.body"

    def test_ws_matching_cookie_passes_through(self):
        """WebSocket with matching cookie passes to inner app."""
        from app.middleware.fly_replay import FlyReplayMiddleware

        inner_called = False

        async def inner(scope, receive, send):
            nonlocal inner_called
            inner_called = True

        scope = _make_ws_scope(cookies={"fly_machine_id": MACHINE_A})
        mw = FlyReplayMiddleware(inner)
        with patch("app.middleware.fly_replay.FLY_MACHINE_ID", MACHINE_A):
            self._run(mw(scope, None, None))

        assert inner_called

    def test_ws_no_cookie_passes_through(self):
        """WebSocket with no fly_machine_id cookie passes to inner app."""
        from app.middleware.fly_replay import FlyReplayMiddleware

        inner_called = False

        async def inner(scope, receive, send):
            nonlocal inner_called
            inner_called = True

        scope = _make_ws_scope()
        mw = FlyReplayMiddleware(inner)
        with patch("app.middleware.fly_replay.FLY_MACHINE_ID", MACHINE_A):
            self._run(mw(scope, None, None))

        assert inner_called

    def test_ws_circuit_breaker_passes_through(self):
        """WebSocket with mismatch + fly-replay-src (circuit-breaker) passes through."""
        from app.middleware.fly_replay import FlyReplayMiddleware

        inner_called = False

        async def inner(scope, receive, send):
            nonlocal inner_called
            inner_called = True

        scope = _make_ws_scope(
            cookies={"fly_machine_id": MACHINE_B},
            headers={"fly-replay-src": f"instance={MACHINE_B};region=lax;t=1234"},
        )
        mw = FlyReplayMiddleware(inner)
        with patch("app.middleware.fly_replay.FLY_MACHINE_ID", MACHINE_A):
            self._run(mw(scope, None, None))

        assert inner_called

    def test_ws_no_fly_env_passes_through(self):
        """When FLY_MACHINE_ID is empty, all WebSocket traffic passes through."""
        from app.middleware.fly_replay import FlyReplayMiddleware

        inner_called = False

        async def inner(scope, receive, send):
            nonlocal inner_called
            inner_called = True

        scope = _make_ws_scope(cookies={"fly_machine_id": MACHINE_B})
        mw = FlyReplayMiddleware(inner)
        with patch("app.middleware.fly_replay.FLY_MACHINE_ID", ""):
            self._run(mw(scope, None, None))

        assert inner_called

    def test_http_scope_always_passes_through(self):
        """HTTP scopes are ignored by FlyReplayMiddleware (handled by db_sync)."""
        from app.middleware.fly_replay import FlyReplayMiddleware

        inner_called = False

        async def inner(scope, receive, send):
            nonlocal inner_called
            inner_called = True

        scope = {"type": "http", "headers": []}
        mw = FlyReplayMiddleware(inner)
        with patch("app.middleware.fly_replay.FLY_MACHINE_ID", MACHINE_A):
            self._run(mw(scope, None, None))

        assert inner_called


# ---------------------------------------------------------------------------
# 9. Cookie attribute consistency
# ---------------------------------------------------------------------------

class TestCookieAttributeConsistency:
    """fly_machine_id cookies must have the same samesite/secure/httponly/path
    attributes as rb_session to ensure both travel together on cross-origin
    requests."""

    def _parse_set_cookies(self, response):
        """Parse all Set-Cookie headers into {name: header_string} dict."""
        result = {}
        for header_val in response.headers.get_list("set-cookie"):
            name = header_val.split("=", 1)[0].strip()
            result[name] = header_val.lower()
        return result

    def test_login_cookies_have_matching_attributes(self, client_on_machine_a):
        """rb_session and fly_machine_id set on login must share attributes."""
        with patch("app.routers.auth._verify_google_token", return_value={
            "email": "test@example.com",
            "sub": "google-id-123",
        }):
            r = client_on_machine_a.post(
                "/api/auth/google",
                json={"token": "fake-token"},
            )
        assert r.status_code == 200
        cookies = self._parse_set_cookies(r)
        assert "rb_session" in cookies
        assert "fly_machine_id" in cookies

        for attr in ["httponly", "path=/"]:
            assert attr in cookies["rb_session"], f"rb_session missing {attr}"
            assert attr in cookies["fly_machine_id"], f"fly_machine_id missing {attr}"

        rb_has_secure = "secure" in cookies["rb_session"]
        fly_has_secure = "secure" in cookies["fly_machine_id"]
        assert rb_has_secure == fly_has_secure, "secure attribute mismatch"

    def test_middleware_cookie_attributes(self, client_on_machine_a):
        """fly_machine_id set by middleware (first request) has correct attributes."""
        r = client_on_machine_a.get(
            "/api/auth/me",
            headers={"X-User-ID": "test-user"},
        )
        cookies = self._parse_set_cookies(r)
        assert "fly_machine_id" in cookies
        cookie = cookies["fly_machine_id"]
        assert "httponly" in cookie
        assert "path=/" in cookie


# ---------------------------------------------------------------------------
# T2720: Post-Export R2 Sync Lock Timeout
# ---------------------------------------------------------------------------

class TestSyncLockTimeout:
    """T2720: Middleware sync defers when the export worker holds the upload lock."""

    def _make_db(self, path):
        conn = sqlite3.connect(str(path))
        conn.execute("CREATE TABLE t (id INTEGER)")
        conn.close()

    def test_profile_sync_defers_when_lock_held(self, tmp_path):
        """Profile sync with lock_timeout returns (False, None) when lock is busy."""
        from app.storage import sync_database_to_r2_with_version, get_upload_lock

        user_id = "test-lock-profile"
        db_path = tmp_path / "profile.sqlite"
        self._make_db(db_path)

        lock = get_upload_lock(user_id, "profile")
        lock.acquire()
        try:
            start = time.perf_counter()
            with patch("app.storage.R2_ENABLED", True), \
                 patch("app.storage.get_r2_sync_client", return_value=MagicMock()), \
                 patch("app.storage.r2_key", return_value="u/profile.sqlite"), \
                 patch("app.storage.R2_BUCKET", "test-bucket"):
                success, version = sync_database_to_r2_with_version(
                    user_id, db_path, current_version=1,
                    skip_version_check=True, lock_timeout=0.1,
                )
            elapsed = time.perf_counter() - start

            assert success is False
            assert version is None
            assert elapsed < 2.0
        finally:
            lock.release()

    def test_user_sync_defers_when_lock_held(self, tmp_path):
        """User DB sync with lock_timeout returns (False, None) when lock is busy."""
        from app.storage import sync_user_db_to_r2_with_version, get_upload_lock

        user_id = "test-lock-user"
        db_path = tmp_path / "user.sqlite"
        self._make_db(db_path)

        lock = get_upload_lock(user_id, "user")
        lock.acquire()
        try:
            start = time.perf_counter()
            with patch("app.storage.R2_ENABLED", True), \
                 patch("app.storage.get_r2_sync_client", return_value=MagicMock()), \
                 patch("app.storage._user_db_r2_key", return_value="u/user.sqlite"), \
                 patch("app.storage.R2_BUCKET", "test-bucket"):
                success, version = sync_user_db_to_r2_with_version(
                    user_id, db_path, current_version=1,
                    skip_version_check=True, lock_timeout=0.1,
                )
            elapsed = time.perf_counter() - start

            assert success is False
            assert version is None
            assert elapsed < 2.0
        finally:
            lock.release()

    def test_sync_proceeds_with_timeout_when_lock_free(self, tmp_path):
        """Sync with lock_timeout still works normally when the lock is available."""
        from app.storage import sync_database_to_r2_with_version

        user_id = "test-lock-free"
        db_path = tmp_path / "profile.sqlite"
        self._make_db(db_path)

        mock_client = MagicMock()
        with patch("app.storage.R2_ENABLED", True), \
             patch("app.storage.get_r2_sync_client", return_value=mock_client), \
             patch("app.storage.r2_key", return_value="u/profile.sqlite"), \
             patch("app.storage.R2_BUCKET", "test-bucket"):
            success, version = sync_database_to_r2_with_version(
                user_id, db_path, current_version=1,
                skip_version_check=True, lock_timeout=0.5,
            )

        assert success is True
        assert version == 2

    def test_default_no_timeout_blocks(self, tmp_path):
        """Without lock_timeout (default), sync blocks until lock is released."""
        from app.storage import sync_database_to_r2_with_version, get_upload_lock
        import threading

        user_id = "test-blocking"
        db_path = tmp_path / "profile.sqlite"
        self._make_db(db_path)

        lock = get_upload_lock(user_id, "profile")
        lock.acquire()

        result = {}

        def release_after_delay():
            time.sleep(0.3)
            lock.release()

        threading.Thread(target=release_after_delay, daemon=True).start()

        mock_client = MagicMock()
        with patch("app.storage.R2_ENABLED", True), \
             patch("app.storage.get_r2_sync_client", return_value=mock_client), \
             patch("app.storage.r2_key", return_value="u/profile.sqlite"), \
             patch("app.storage.R2_BUCKET", "test-bucket"):
            start = time.perf_counter()
            success, version = sync_database_to_r2_with_version(
                user_id, db_path, current_version=1,
                skip_version_check=True,
            )
            elapsed = time.perf_counter() - start

        assert success is True
        assert elapsed >= 0.2
