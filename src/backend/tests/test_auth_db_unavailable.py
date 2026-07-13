"""Auth middleware behavior when the session-validation DB is unreachable.

A transient Postgres outage during session validation must NOT read as
"logged out" (401). A present-but-unverifiable cookie returns 503 + Retry-After
so clients (and the <video> element, which renders MEDIA_ELEMENT_ERROR on a 401)
retry instead of forcing a re-login. See db_sync.py session_validation_unavailable.
"""
import os
from unittest.mock import patch

import psycopg2
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.middleware.db_sync.FLY_MACHINE_ID", "", create=True), \
         patch.dict(os.environ, {"APP_ENV": "production"}):
        # APP_ENV=production so the X-User-ID header fallback is disabled and the
        # cookie path is the only auth source under test.
        from app.main import app
        yield TestClient(app, raise_server_exceptions=False)


# A non-allowlisted, auth-required route. /api/projects needs a user context.
PROTECTED_PATH = "/api/projects"


def test_db_unavailable_with_cookie_returns_503_retryable(client):
    """Cookie present + Postgres down during validation -> 503 + Retry-After."""
    with patch(
        "app.middleware.db_sync.validate_session",
        side_effect=psycopg2.OperationalError("server closed the connection unexpectedly"),
    ):
        client.cookies.set("rb_session", "some-session-id")
        resp = client.get(PROTECTED_PATH)
    assert resp.status_code == 503
    assert resp.headers.get("Retry-After") == "2"
    assert resp.json()["detail"] == "Service temporarily unavailable, please retry."


def test_no_cookie_still_returns_401(client):
    """No cookie -> genuinely unauthenticated -> 401 (unchanged)."""
    resp = client.get(PROTECTED_PATH)
    assert resp.status_code == 401


def test_invalid_cookie_with_healthy_db_returns_401(client):
    """Cookie present but invalid (DB healthy, returns no session) -> 401, not 503.

    Only a DB *outage* is retryable; a validated-but-unknown session is a real
    auth failure.
    """
    with patch("app.middleware.db_sync.validate_session", return_value=None):
        client.cookies.set("rb_session", "bogus")
        resp = client.get(PROTECTED_PATH)
    assert resp.status_code == 401
