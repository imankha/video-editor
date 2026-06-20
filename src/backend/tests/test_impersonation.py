"""
T1510: Admin impersonation tests.

Covers the design doc's required test cases (§8):
  1. start creates session + audit row
  2. admin cannot impersonate another admin (SECURITY)
  3. cannot impersonate self
  4. non-existent target returns 404
  5. TTL expiry drops to invalid session + audit 'expire' row (SECURITY)
  6. stop restores admin session
  7. stop when not impersonating returns 400
  8. non-admin caller gets 403
  9. /api/auth/me includes impersonator block when active
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


# Dedicated test admin email -- must NOT be a real dev account (e.g. the
# developer's imankh@gmail.com) or create_user collides on the unique email
# constraint, since pg_conn intentionally preserves real accounts.
ADMIN_EMAIL = "testadmin@example.com"


@pytest.fixture()
def isolated_auth_db(pg_conn):
    """Fresh Postgres with one admin and two regulars."""
    from app.services.auth_db import create_user, get_auth_db
    create_user("admin-user", email=ADMIN_EMAIL)
    create_user("other-admin", email="secondadmin@example.com")
    create_user("target-user", email="target@example.com")
    create_user("other-regular", email="regular@example.com")
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO admin_users (email) VALUES (%s) ON CONFLICT DO NOTHING",
            (ADMIN_EMAIL,),
        )
        cur.execute(
            "INSERT INTO admin_users (email) VALUES (%s) ON CONFLICT DO NOTHING",
            ("secondadmin@example.com",),
        )
    yield


@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    with patch("app.database.USER_DATA_BASE", tmp_path):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _admin_headers(user_id="admin-user"):
    return {"X-User-ID": user_id}


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class TestSchema:
    def test_impersonation_audit_table_exists(self, isolated_auth_db):
        from app.services.auth_db import get_auth_db
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_name = 'impersonation_audit'"
            )
            row = cur.fetchone()
        assert row is not None

    def test_sessions_has_impersonator_columns(self, isolated_auth_db):
        from app.services.auth_db import get_auth_db
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'sessions'"
            )
            cols = [r["column_name"] for r in cur.fetchall()]
        assert "impersonator_user_id" in cols
        assert "impersonation_expires_at" in cols


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------

class TestStart:
    def test_start_creates_session_and_audit(self, client):
        r = client.post("/api/admin/impersonate/target-user", headers=_admin_headers())
        assert r.status_code == 200, r.text
        assert "rb_session" in r.cookies

        from app.services.auth_db import get_auth_db
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM impersonation_audit WHERE action='start'"
            )
            audit = cur.fetchone()
        assert audit is not None
        assert audit["admin_user_id"] == "admin-user"
        assert audit["target_user_id"] == "target-user"

        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM sessions WHERE impersonator_user_id IS NOT NULL"
            )
            sess = cur.fetchone()
        assert sess is not None
        assert sess["user_id"] == "target-user"
        assert sess["impersonator_user_id"] == "admin-user"
        assert sess["impersonation_expires_at"] is not None

    def test_admin_cannot_impersonate_admin(self, client):
        """SECURITY: privilege laundering must be blocked."""
        r = client.post(
            "/api/admin/impersonate/other-admin", headers=_admin_headers()
        )
        assert r.status_code == 403
        assert "admin" in r.text.lower()

        from app.services.auth_db import get_auth_db
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT count(*) as cnt FROM impersonation_audit WHERE action='start'"
            )
            start_rows = cur.fetchone()["cnt"]
            cur.execute(
                "SELECT count(*) as cnt FROM sessions WHERE impersonator_user_id IS NOT NULL"
            )
            imp_sessions = cur.fetchone()["cnt"]
        assert start_rows == 0
        assert imp_sessions == 0

    def test_cannot_impersonate_self(self, client):
        r = client.post(
            "/api/admin/impersonate/admin-user", headers=_admin_headers()
        )
        assert r.status_code == 400

    def test_nonexistent_target_404(self, client):
        r = client.post(
            "/api/admin/impersonate/does-not-exist", headers=_admin_headers()
        )
        assert r.status_code == 404

    def test_non_admin_forbidden(self, client):
        r = client.post(
            "/api/admin/impersonate/target-user",
            headers={"X-User-ID": "other-regular"},
        )
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# TTL
# ---------------------------------------------------------------------------

class TestTTL:
    def test_expired_impersonation_invalidates_and_audits(self, client):
        """SECURITY: TTL must be enforced and expiry audited."""
        r = client.post(
            "/api/admin/impersonate/target-user", headers=_admin_headers()
        )
        assert r.status_code == 200
        session_id = r.cookies.get("rb_session")

        from app.services.auth_db import get_auth_db, validate_session
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE sessions SET impersonation_expires_at=%s WHERE session_id=%s",
                (past, session_id),
            )

        assert validate_session(session_id) is None

        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM impersonation_audit WHERE action='expire'"
            )
            expire_row = cur.fetchone()
        assert expire_row is not None


# ---------------------------------------------------------------------------
# Stop
# ---------------------------------------------------------------------------

class TestStop:
    def test_stop_restores_admin_session(self, client):
        r = client.post(
            "/api/admin/impersonate/target-user", headers=_admin_headers()
        )
        assert r.status_code == 200
        imp_sid = r.cookies.get("rb_session")

        r = client.post("/api/admin/impersonate/stop")
        assert r.status_code == 200, r.text

        restored_sid = r.cookies.get("rb_session")
        assert restored_sid is not None
        assert restored_sid != imp_sid

        from app.services.auth_db import validate_session
        sess = validate_session(restored_sid)
        assert sess is not None
        assert sess["user_id"] == "admin-user"

        assert validate_session(imp_sid) is None

        from app.services.auth_db import get_auth_db
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT * FROM impersonation_audit WHERE action='stop'"
            )
            stop_row = cur.fetchone()
        assert stop_row is not None

    def test_stop_when_not_impersonating_returns_400(self, client):
        r = client.post(
            "/api/admin/impersonate/stop", headers=_admin_headers()
        )
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# /me
# ---------------------------------------------------------------------------

class TestMe:
    def test_me_includes_impersonator_when_active(self, client):
        r = client.post(
            "/api/admin/impersonate/target-user", headers=_admin_headers()
        )
        assert r.status_code == 200

        r = client.get("/api/auth/me")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user_id"] == "target-user"
        assert body.get("impersonator") is not None
        assert body["impersonator"]["id"] == "admin-user"
        assert body["impersonator"]["email"] == ADMIN_EMAIL

    def test_me_impersonator_is_null_when_not_impersonating(self, client):
        from app.services.auth_db import create_session
        sid = create_session("admin-user")
        client.cookies.set("rb_session", sid)

        r = client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["user_id"] == "admin-user"
        assert body.get("impersonator") is None
