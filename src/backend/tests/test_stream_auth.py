"""
T1490: guard against auth middleware regression on the clip /stream endpoint.

Background:
    GET /api/clips/projects/{pid}/clips/{cid}/stream without any auth context
    (no rb_session cookie, no X-User-ID header) must be rejected 401 by the
    auth middleware at src/backend/app/middleware/db_sync.py:206.

    When the caller IS authenticated (X-User-ID header in tests, session
    cookie in prod), the request must pass the middleware and be routed to
    the stream handler. For an unknown clip id the handler returns 404 —
    the key assertion is that the response is NOT 401 (i.e. auth middleware
    allowed it through).

These tests are a regression guard only — they don't depend on T1490's
frontend fix. They fail if middleware auth is ever relaxed on /stream.
"""
from fastapi.testclient import TestClient

from app.main import app


STREAM_PATH = "/api/clips/projects/999999/clips/999999/stream"


def test_stream_without_auth_returns_401():
    """No cookie + no X-User-ID → 401 from auth middleware."""
    client = TestClient(app)
    # TestClient does not carry cookies/headers across unless configured; be
    # explicit that we send nothing.
    r = client.get(STREAM_PATH, headers={})
    assert r.status_code == 401, (
        f"expected 401 for unauthenticated /stream, got {r.status_code}: {r.text}"
    )


def test_stream_with_auth_header_is_not_401():
    """With X-User-ID the request passes auth; handler may 404/422/416 but never 401."""
    client = TestClient(app)
    r = client.get(STREAM_PATH, headers={"X-User-ID": "testdefault"})
    assert r.status_code != 401, (
        f"authenticated request should not be rejected by auth middleware, "
        f"got 401: {r.text}"
    )
    # Clip 999999 does not exist → expect 404 from handler (not 401).
    assert r.status_code in (200, 206, 404, 416, 422), (
        f"unexpected status {r.status_code}: {r.text}"
    )
