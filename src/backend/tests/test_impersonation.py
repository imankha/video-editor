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

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def isolated_auth_db(tmp_path):
    """Fresh auth.sqlite with one admin and two regulars."""
    db_path = tmp_path / "auth.sqlite"
    with patch("app.services.auth_db.AUTH_DB_PATH", db_path), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True):
        from app.services.auth_db import init_auth_db, create_user, get_auth_db
        init_auth_db()
        create_user("admin-user", email="imankh@gmail.com")
        create_user("other-admin", email="secondadmin@example.com")
        create_user("target-user", email="target@example.com")
        create_user("other-regular", email="regular@example.com")
        # Promote the second admin
        with get_auth_db() as db:
            db.execute(
                "INSERT OR IGNORE INTO admin_users (email) VALUES (?)",
                ("secondadmin@example.com",),
            )
            db.commit()
        yield db_path


@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    with patch("app.services.auth_db.AUTH_DB_PATH", isolated_auth_db), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True), \
         patch("app.database.USER_DATA_BASE", tmp_path):
        # Clear the in-process session cache between tests
        from app.services.auth_db import _session_cache
        _session_cache.clear()
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _admin_headers(user_id="admin-user"):
    return {"X-User-ID": user_id}


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class TestSchema:
    def test_impersonation_audit_table_exists(self, isolated_auth_db):
        conn = sqlite3.connect(str(isolated_auth_db))
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='impersonation_audit'"
        ).fetchone()
        conn.close()
        assert row is not None

    def test_sessions_has_impersonator_columns(self, isolated_auth_db):
        conn = sqlite3.connect(str(isolated_auth_db))
        cols = [r[1] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()]
        conn.close()
        assert "impersonator_user_id" in cols
        assert "impersonation_expires_at" in cols


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------

class TestStart:
    def test_start_creates_session_and_audit(self, client, isolated_auth_db):
        r = client.post("/api/admin/impersonate/target-user", headers=_admin_headers())
        assert r.status_code == 200, r.text
        assert "rb_session" in r.cookies

        conn = sqlite3.connect(str(isolated_auth_db))
        conn.row_factory = sqlite3.Row
        audit = conn.execute(
            "SELECT * FROM impersonation_audit WHERE action='start'"
        ).fetchone()
        assert audit is not None
        assert audit["admin_user_id"] == "admin-user"
        assert audit["target_user_id"] == "target-user"

        sess = conn.execute(
            "SELECT * FROM sessions WHERE impersonator_user_id IS NOT NULL"
        ).fetchone()
        conn.close()
        assert sess is not None
        assert sess["user_id"] == "target-user"
        assert sess["impersonator_user_id"] == "admin-user"
        assert sess["impersonation_expires_at"] is not None

    def test_admin_cannot_impersonate_admin(self, client, isolated_auth_db):
        """SECURITY: privilege laundering must be blocked."""
        r = client.post(
            "/api/admin/impersonate/other-admin", headers=_admin_headers()
        )
        assert r.status_code == 403
        assert "admin" in r.text.lower()

        conn = sqlite3.connect(str(isolated_auth_db))
        start_rows = conn.execute(
            "SELECT count(*) FROM impersonation_audit WHERE action='start'"
        ).fetchone()[0]
        imp_sessions = conn.execute(
            "SELECT count(*) FROM sessions WHERE impersonator_user_id IS NOT NULL"
        ).fetchone()[0]
        conn.close()
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
    def test_expired_impersonation_invalidates_and_audits(
        self, client, isolated_auth_db
    ):
        """SECURITY: TTL must be enforced and expiry audited."""
        # Start
        r = client.post(
            "/api/admin/impersonate/target-user", headers=_admin_headers()
        )
        assert r.status_code == 200
        session_id = r.cookies.get("rb_session")

        # Backdate impersonation_expires_at to the past
        conn = sqlite3.connect(str(isolated_auth_db))
        past = (datetime.utcnow() - timedelta(minutes=5)).isoformat()
        conn.execute(
            "UPDATE sessions SET impersonation_expires_at=? WHERE session_id=?",
            (past, session_id),
        )
        conn.commit()
        conn.close()

        # Clear in-process cache so validate_session re-reads from DB
        from app.services.auth_db import _session_cache, validate_session
        _session_cache.pop(session_id, None)

        # validate_session should return None (expired)
        assert validate_session(session_id) is None

        # audit 'expire' row must exist
        conn = sqlite3.connect(str(isolated_auth_db))
        expire_row = conn.execute(
            "SELECT * FROM impersonation_audit WHERE action='expire'"
        ).fetchone()
        conn.close()
        assert expire_row is not None


# ---------------------------------------------------------------------------
# Stop
# ---------------------------------------------------------------------------

class TestStop:
    def test_stop_restores_admin_session(self, client, isolated_auth_db):
        # Start impersonation; TestClient will carry the Set-Cookie forward
        r = client.post(
            "/api/admin/impersonate/target-user", headers=_admin_headers()
        )
        assert r.status_code == 200
        imp_sid = r.cookies.get("rb_session")

        # Stop — uses the impersonation cookie (no X-User-ID needed since
        # middleware resolves target-user from the session row). The stop
        # endpoint identifies the admin via session.impersonator_user_id.
        r = client.post("/api/admin/impersonate/stop")
        assert r.status_code == 200, r.text

        restored_sid = r.cookies.get("rb_session")
        assert restored_sid is not None
        assert restored_sid != imp_sid

        # Restored session must resolve to admin-user
        from app.services.auth_db import _session_cache, validate_session
        _session_cache.pop(restored_sid, None)
        sess = validate_session(restored_sid)
        assert sess is not None
        assert sess["user_id"] == "admin-user"

        # Impersonation session is gone
        _session_cache.pop(imp_sid, None)
        assert validate_session(imp_sid) is None

        # audit 'stop' row exists
        conn = sqlite3.connect(str(isolated_auth_db))
        stop_row = conn.execute(
            "SELECT * FROM impersonation_audit WHERE action='stop'"
        ).fetchone()
        conn.close()
        assert stop_row is not None

    def test_stop_when_not_impersonating_returns_400(self, client):
        # Admin calling stop via header auth (no impersonation session)
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
        assert body["impersonator"]["email"] == "imankh@gmail.com"

    def test_me_impersonator_is_null_when_not_impersonating(
        self, client, isolated_auth_db
    ):
        # Create a plain session for the admin
        from app.services.auth_db import create_session
        sid = create_session("admin-user")
        client.cookies.set("rb_session", sid)

        r = client.get("/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["user_id"] == "admin-user"
        assert body.get("impersonator") is None
