"""
Tests for the admin panel (T550).

Tests cover:
- admin_users table created on init + seeded with imankh@gmail.com
- is_admin() returns True for admin, False for non-admin
- GET /api/admin/me returns {is_admin: bool} without 403
- GET /api/admin/users returns 403 for non-admin
- GET /api/admin/users returns users list for admin
- POST /api/admin/users/{id}/grant-credits grants credits
- GPU aggregation sums correctly across export_jobs
"""

import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def isolated_auth_db(tmp_path):
    """Fresh auth.sqlite for each test."""
    db_path = tmp_path / "auth.sqlite"
    with patch("app.services.auth_db.AUTH_DB_PATH", db_path), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True):
        from app.services.auth_db import init_auth_db, create_user
        init_auth_db()
        create_user("admin-user", email="imankh@gmail.com")
        create_user("regular-user", email="other@example.com")
        yield db_path


@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    """TestClient wired to a test user context."""
    with patch("app.services.auth_db.AUTH_DB_PATH", isolated_auth_db), \
         patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True), \
         patch("app.database.USER_DATA_BASE", tmp_path):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


def _auth_headers(user_id: str) -> dict:
    return {"X-User-ID": user_id}


# ---------------------------------------------------------------------------
# auth_db unit tests
# ---------------------------------------------------------------------------

class TestAdminUsersTable:
    def test_table_exists_after_init(self, isolated_auth_db):
        conn = sqlite3.connect(str(isolated_auth_db))
        row = conn.execute("SELECT count(*) FROM admin_users").fetchone()
        conn.close()
        assert row[0] >= 1

    def test_seed_email_present(self, isolated_auth_db):
        conn = sqlite3.connect(str(isolated_auth_db))
        row = conn.execute(
            "SELECT 1 FROM admin_users WHERE email = 'imankh@gmail.com'"
        ).fetchone()
        conn.close()
        assert row is not None

    def test_seed_is_idempotent(self, isolated_auth_db):
        """Calling init_auth_db() again must not raise or duplicate the seed."""
        with patch("app.services.auth_db.AUTH_DB_PATH", isolated_auth_db), \
             patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True):
            from app.services.auth_db import init_auth_db
            init_auth_db()  # second call
        conn = sqlite3.connect(str(isolated_auth_db))
        row = conn.execute("SELECT count(*) FROM admin_users WHERE email = 'imankh@gmail.com'").fetchone()
        conn.close()
        assert row[0] == 1


class TestIsAdmin:
    def test_admin_user_returns_true(self, isolated_auth_db):
        with patch("app.services.auth_db.AUTH_DB_PATH", isolated_auth_db):
            from app.services.auth_db import is_admin
            assert is_admin("admin-user") is True

    def test_regular_user_returns_false(self, isolated_auth_db):
        with patch("app.services.auth_db.AUTH_DB_PATH", isolated_auth_db):
            from app.services.auth_db import is_admin
            assert is_admin("regular-user") is False

    def test_unknown_user_returns_false(self, isolated_auth_db):
        with patch("app.services.auth_db.AUTH_DB_PATH", isolated_auth_db):
            from app.services.auth_db import is_admin
            assert is_admin("nonexistent-user") is False


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------

class TestAdminMe:
    def test_admin_user_gets_true(self, client):
        resp = client.get("/api/admin/me", headers=_auth_headers("admin-user"))
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is True

    def test_regular_user_gets_false(self, client):
        resp = client.get("/api/admin/me", headers=_auth_headers("regular-user"))
        assert resp.status_code == 200
        assert resp.json()["is_admin"] is False


class TestAdminUsers:
    def test_non_admin_gets_403(self, client):
        resp = client.get("/api/admin/users", headers=_auth_headers("regular-user"))
        assert resp.status_code == 403

    def test_admin_gets_user_list(self, client):
        resp = client.get("/api/admin/users", headers=_auth_headers("admin-user"))
        assert resp.status_code == 200
        users = resp.json()
        user_ids = [u["user_id"] for u in users]
        assert "admin-user" in user_ids
        assert "regular-user" in user_ids

    def test_user_list_has_required_fields(self, client):
        resp = client.get("/api/admin/users", headers=_auth_headers("admin-user"))
        assert resp.status_code == 200
        for user in resp.json():
            assert "user_id" in user
            assert "email" in user
            assert "credits" in user
            assert "quest_progress" in user
            assert "gpu_seconds_total" in user


class TestAdminGrantCredits:
    def test_non_admin_gets_403(self, client):
        resp = client.post(
            "/api/admin/users/regular-user/grant-credits",
            json={"amount": 10},
            headers=_auth_headers("regular-user"),
        )
        assert resp.status_code == 403

    def test_admin_can_grant_credits(self, client):
        resp = client.post(
            "/api/admin/users/regular-user/grant-credits",
            json={"amount": 50},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 200
        assert resp.json()["balance"] == 50

    def test_zero_amount_rejected(self, client):
        resp = client.post(
            "/api/admin/users/regular-user/grant-credits",
            json={"amount": 0},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 400


class TestGpuAggregation:
    def test_gpu_usage_sums_across_profiles(self, tmp_path, isolated_auth_db):
        """GPU seconds from multiple profile DBs are summed correctly."""
        # Create a fake profile DB with export_jobs containing gpu_seconds
        profile_dir = tmp_path / "regular-user" / "profiles" / "profile-1"
        profile_dir.mkdir(parents=True)
        db_path = profile_dir / "profile.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.execute("""
            CREATE TABLE export_jobs (
                id TEXT PRIMARY KEY, type TEXT, status TEXT,
                gpu_seconds REAL, modal_function TEXT, created_at TEXT,
                input_data TEXT DEFAULT '{}'
            )
        """)
        conn.execute(
            "INSERT INTO export_jobs VALUES ('j1','framing','complete',120.5,'framing','2026-03-01','{}')"
        )
        conn.execute(
            "INSERT INTO export_jobs VALUES ('j2','overlay','complete',30.0,'overlay','2026-03-02','{}')"
        )
        conn.commit()
        conn.close()

        with patch("app.services.auth_db.AUTH_DB_PATH", isolated_auth_db), \
             patch("app.services.auth_db.sync_auth_db_to_r2", return_value=True), \
             patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.routers.admin.USER_DATA_BASE", tmp_path):
            from app.routers.admin import _compute_gpu_total
            import asyncio
            total = asyncio.run(_compute_gpu_total("regular-user"))

        assert total == 150.5

    def test_gpu_usage_endpoint_non_admin_gets_403(self, client):
        resp = client.get(
            "/api/admin/users/regular-user/gpu-usage",
            headers=_auth_headers("regular-user"),
        )
        assert resp.status_code == 403
