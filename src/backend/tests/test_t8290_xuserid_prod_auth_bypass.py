"""T8290: X-User-ID must never authenticate a production request.

Two independent bypasses, both closed here:
1. db_sync.py's admin-route carve-out (`or is_admin_route`) let the header
   authenticate ANY /api/admin/ route on prod with no cookie/token.
2. shares.py's _get_email_from_request/_get_user_id_from_request read the
   header with no APP_ENV guard at all -- reachable because /api/shared/ is
   allowlisted, so middleware never rejects an unauthenticated request there.

Every test proves: header alone -> rejected in production; a real session
cookie -> still works. Non-production behavior (existing, unchanged) is not
re-tested here -- it's covered by the many other tests that rely on the
X-User-ID dev/test shortcut.
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

import app.middleware.db_sync as db_sync_mod
import app.routers.shares as shares_mod


class FakeRequest:
    """Minimal Request stand-in: only .headers and .cookies are touched by
    the two helpers under test. Uses real starlette Headers (case-insensitive
    lookup, matching production) rather than a plain dict."""

    def __init__(self, headers=None, cookies=None):
        self._headers = Headers(headers or {})
        self._cookies = dict(cookies or {})

    @property
    def headers(self):
        return self._headers

    @property
    def cookies(self):
        return self._cookies


# ---------------------------------------------------------------------------
# shares.py helpers, direct unit tests -- every route above (claim, PATCH/
# DELETE /shared/{token}, the private-share recipient gate) resolves auth
# through one of these two functions, so this is the single canonical proof
# for all of them.
# ---------------------------------------------------------------------------

def test_get_user_id_from_request_ignores_header_in_production(monkeypatch):
    monkeypatch.setattr(shares_mod, "APP_ENV", "production")
    req = FakeRequest(headers={"X-User-ID": "some-admin-user-id"})
    assert shares_mod._get_user_id_from_request(req) is None


def test_get_user_id_from_request_still_honors_header_outside_production(monkeypatch):
    monkeypatch.setattr(shares_mod, "APP_ENV", "dev")
    req = FakeRequest(headers={"X-User-ID": "some-user-id"})
    assert shares_mod._get_user_id_from_request(req) == "some-user-id"


def test_get_user_id_from_request_cookie_works_in_production(monkeypatch):
    monkeypatch.setattr(shares_mod, "APP_ENV", "production")
    with patch.object(shares_mod, "validate_session", return_value={"user_id": "u_real", "email": "u@x.com"}):
        req = FakeRequest(cookies={"rb_session": "sid123"})
        assert shares_mod._get_user_id_from_request(req) == "u_real"


def test_get_email_from_request_ignores_header_in_production(monkeypatch):
    monkeypatch.setattr(shares_mod, "APP_ENV", "production")
    with patch.object(shares_mod, "get_user_by_id", return_value={"email": "leaked@x.com"}) as mock_lookup:
        req = FakeRequest(headers={"X-User-ID": "some-user-id"})
        assert shares_mod._get_email_from_request(req) is None
        mock_lookup.assert_not_called()  # must not even look the header value up


def test_get_email_from_request_cookie_works_in_production(monkeypatch):
    monkeypatch.setattr(shares_mod, "APP_ENV", "production")
    with patch.object(shares_mod, "validate_session", return_value={"user_id": "u_real", "email": "real@x.com"}):
        req = FakeRequest(cookies={"rb_session": "sid123"})
        assert shares_mod._get_email_from_request(req) == "real@x.com"


# ---------------------------------------------------------------------------
# End-to-end proof that the wiring is real: the claim route (a genuine
# _get_user_id_from_request call site) behaves correctly through the full
# ASGI stack, not just in isolation.
# ---------------------------------------------------------------------------

@pytest.fixture()
def prod_client(pg_conn, tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch.object(db_sync_mod, "APP_ENV", "production"), \
         patch.object(shares_mod, "APP_ENV", "production"):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def test_claim_route_header_alone_rejected_in_production(prod_client):
    resp = prod_client.post(
        "/api/shared/game/nonexistent-token/claim",
        json={},
        headers={"X-User-ID": "some-user-id"},
    )
    assert resp.status_code == 401


def test_claim_route_cookie_reaches_business_logic_in_production(prod_client):
    from app.services.auth_db import create_session, create_user

    # "claimer-user" is in conftest's _TEST_USER_IDS allowlist (T5730), so
    # pg_conn cleans it up before every test -- an ad-hoc id would leak into
    # the shared dev DB across runs.
    create_user("claimer-user", email="claim-test@test.local")
    sid = create_session("claimer-user")
    prod_client.cookies.set("rb_session", sid)

    resp = prod_client.post("/api/shared/game/nonexistent-token/claim", json={})
    # Cookie auth succeeded (past the 401 gate); the token itself doesn't
    # exist, so business logic correctly reports 404, not 401.
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Admin surface (db_sync.py carve-out).
# ---------------------------------------------------------------------------

@pytest.fixture()
def admin_client(pg_conn, tmp_path):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg

    # "admin-user" is in conftest's _TEST_USER_IDS allowlist (test_admin.py's
    # own fixture uses it too), so pg_conn cleans it up before every test.
    create_user("admin-user", email="test-admin@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )
        cur.execute(
            "INSERT INTO user_segments (user_id) VALUES ('admin-user') ON CONFLICT (user_id) DO NOTHING"
        )

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch.object(db_sync_mod, "APP_ENV", "production"):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def test_admin_route_header_alone_rejected_in_production(admin_client):
    resp = admin_client.get(
        "/api/admin/users",
        headers={"X-User-ID": "admin-user"},
    )
    assert resp.status_code == 401


def test_admin_impersonate_header_alone_rejected_in_production(admin_client):
    """The escalation path (T8290's blast-radius §): full account takeover
    via impersonation must be just as unreachable via the header as any
    other admin route."""
    resp = admin_client.post(
        "/api/admin/impersonate/some-target-user",
        headers={"X-User-ID": "admin-user"},
    )
    assert resp.status_code == 401


def test_admin_route_cookie_still_works_in_production(admin_client):
    from app.services.auth_db import create_session

    sid = create_session("admin-user")
    admin_client.cookies.set("rb_session", sid)

    resp = admin_client.get("/api/admin/users")
    assert resp.status_code == 200
