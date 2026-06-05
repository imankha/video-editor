"""
Tests for the admin panel (T550, T3020).

Tests cover:
- admin_users table created on init + seeded with imankh@gmail.com
- is_admin() returns True for admin, False for non-admin
- GET /api/admin/me returns {is_admin: bool} without 403
- GET /api/admin/users returns 403 for non-admin
- GET /api/admin/users returns users with milestones data
- GET /api/admin/users pagination works
- GET /api/admin/users LEFT JOIN returns users without milestones
- POST /api/admin/users/{id}/grant-credits grants credits
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def isolated_auth_db(pg_conn):
    """Fresh Postgres with admin + regular user.

    Uses test-admin@test.local so the email unique constraint doesn't clash
    with real users in the dev database. The admin_users seed (imankh@gmail.com)
    is matched by email, so we insert into admin_users for the test email too.
    """
    from app.services.auth_db import create_user
    from app.services.pg import get_pg
    create_user("admin-user", email="test-admin@test.local")
    create_user("regular-user", email="other@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
        )
    yield


@pytest.fixture()
def milestones_data(pg_conn):
    """Insert user_segments and user_actions rows for test users."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO user_segments (user_id, acquired_at, origin, signup_method)
            VALUES
            ('admin-user', '2026-01-15', 'organic', 'google'),
            ('regular-user', '2026-03-10', 'organic', 'otp')
        """)
        actions = [
            ("admin-user", "game_created", 10),
            ("admin-user", "clip_created", 25),
            ("admin-user", "export_completed", 5),
            ("admin-user", "export_failed", 1),
            ("admin-user", "share_completed", 2),
            ("admin-user", "credit_purchased", 3),
            ("admin-user", "credits_consumed", 50),
            ("admin-user", "session_started", 20),
            ("regular-user", "game_created", 3),
            ("regular-user", "clip_created", 8),
            ("regular-user", "export_completed", 1),
            ("regular-user", "session_started", 5),
        ]
        for user_id, action, count in actions:
            cur.execute(
                "INSERT INTO user_actions (user_id, action, count) VALUES (%s, %s, %s)",
                (user_id, action, count),
            )
    yield


@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    """TestClient wired to a test user context."""
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


@pytest.fixture()
def client_with_milestones(isolated_auth_db, milestones_data, tmp_path):
    """TestClient with milestones data populated."""
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        return TestClient(app, raise_server_exceptions=True)


def _auth_headers(user_id: str) -> dict:
    return {"X-User-ID": user_id}


# ---------------------------------------------------------------------------
# auth_db unit tests
# ---------------------------------------------------------------------------

class TestAdminUsersTable:
    def test_table_exists_after_init(self, isolated_auth_db):
        from app.services.auth_db import get_auth_db
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT count(*) as cnt FROM admin_users")
            row = cur.fetchone()
        assert row["cnt"] >= 1

    def test_seed_email_present(self, isolated_auth_db):
        from app.services.auth_db import get_auth_db
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT 1 FROM admin_users WHERE email = 'test-admin@test.local'"
            )
            row = cur.fetchone()
        assert row is not None

    def test_seed_is_idempotent(self, isolated_auth_db):
        """Re-seeding must not raise or duplicate the seed."""
        from app.services.pg import get_pg
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING"
            )
        from app.services.auth_db import get_auth_db
        with get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT count(*) as cnt FROM admin_users WHERE email = 'test-admin@test.local'")
            row = cur.fetchone()
        assert row["cnt"] == 1


class TestIsAdmin:
    def test_admin_user_returns_true(self, isolated_auth_db):
        from app.services.auth_db import is_admin
        assert is_admin("admin-user") is True

    def test_regular_user_returns_false(self, isolated_auth_db):
        from app.services.auth_db import is_admin
        assert is_admin("regular-user") is False

    def test_unknown_user_returns_false(self, isolated_auth_db):
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
        data = resp.json()
        user_ids = [u["user_id"] for u in data["users"]]
        assert "admin-user" in user_ids
        assert "regular-user" in user_ids

    def test_response_shape(self, client):
        resp = client.get("/api/admin/users", headers=_auth_headers("admin-user"))
        assert resp.status_code == 200
        data = resp.json()
        assert "users" in data
        assert "total_users" in data
        assert "total_pages" in data
        assert "page" in data
        for user in data["users"]:
            assert "user_id" in user
            assert "email" in user
            assert "credits" in user
            assert "origin" in user
            assert "acquired_at" in user
            assert "session_count" in user
            assert "last_active_at" in user

    def test_milestones_data_included(self, client_with_milestones):
        resp = client_with_milestones.get(
            "/api/admin/users", headers=_auth_headers("admin-user")
        )
        assert resp.status_code == 200
        data = resp.json()
        admin = next(u for u in data["users"] if u["user_id"] == "admin-user")
        assert admin["origin"] == "organic"
        assert admin["game_created_count"] == 10
        assert admin["clip_created_count"] == 25
        assert admin["export_completed_count"] == 5
        assert admin["session_count"] == 20

        regular = next(u for u in data["users"] if u["user_id"] == "regular-user")
        assert regular["origin"] == "organic"
        assert regular["acquired_at"] == "2026-03-10"

    def test_left_join_users_without_segments(self, client):
        """Users without segment rows still appear with NULL/zero values."""
        resp = client.get("/api/admin/users", headers=_auth_headers("admin-user"))
        assert resp.status_code == 200
        data = resp.json()
        user_ids = [u["user_id"] for u in data["users"]]
        assert "admin-user" in user_ids
        admin = next(u for u in data["users"] if u["user_id"] == "admin-user")
        assert admin["game_created_count"] == 0
        assert admin["origin"] is None

    def test_pagination(self, client_with_milestones):
        resp = client_with_milestones.get(
            "/api/admin/users?page=1&page_size=1",
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["users"]) == 1
        assert data["total_users"] >= 2
        assert data["total_pages"] >= 2
        assert data["page"] == 1

        resp2 = client_with_milestones.get(
            "/api/admin/users?page=2&page_size=1",
            headers=_auth_headers("admin-user"),
        )
        data2 = resp2.json()
        assert len(data2["users"]) == 1
        assert data2["page"] == 2

    def test_pagination_returns_all_test_users(self, client_with_milestones):
        """Fetching all pages includes both test users."""
        resp = client_with_milestones.get(
            "/api/admin/users?page=1&page_size=50",
            headers=_auth_headers("admin-user"),
        )
        data = resp.json()
        user_ids = [u["user_id"] for u in data["users"]]
        assert "admin-user" in user_ids
        assert "regular-user" in user_ids


class TestAdminGrantCredits:
    def test_non_admin_gets_403(self, client):
        resp = client.post(
            "/api/admin/users/regular-user/grant-credits",
            json={"amount": 10},
            headers=_auth_headers("regular-user"),
        )
        assert resp.status_code == 403

    def test_admin_can_grant_credits(self, client):
        from app.services.user_db import get_credit_balance
        balance_before = get_credit_balance("regular-user")["balance"]
        resp = client.post(
            "/api/admin/users/regular-user/grant-credits",
            json={"amount": 50},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 200
        assert resp.json()["balance"] == balance_before + 50

    def test_zero_amount_rejected(self, client):
        resp = client.post(
            "/api/admin/users/regular-user/grant-credits",
            json={"amount": 0},
            headers=_auth_headers("admin-user"),
        )
        assert resp.status_code == 400
