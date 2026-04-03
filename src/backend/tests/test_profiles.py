"""
Tests for Profile Switching — Multi-Athlete Support

Tests for:
- Profile CRUD endpoints (list, create, update, delete)
- Profile switch endpoint
- Cannot delete last profile
- session_init cache invalidation

Profiles are stored in user.sqlite (source of truth).

Run with: pytest tests/test_profiles.py -v
"""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


def _uid(prefix: str = "test") -> str:
    """Generate a unique user ID for test isolation."""
    return f"{prefix}_{uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# Session init cache invalidation
# ---------------------------------------------------------------------------

class TestInvalidateUserCache:
    """Test invalidate_user_cache() clears the session init cache."""

    def test_clears_cached_user(self):
        """Should remove user from _init_cache."""
        from app.session_init import _init_cache, invalidate_user_cache
        _init_cache["testuser"] = {"profile_id": "abc", "is_new_user": False}
        invalidate_user_cache("testuser")
        assert "testuser" not in _init_cache

    def test_no_error_for_missing_user(self):
        """Should not raise if user not in cache."""
        from app.session_init import invalidate_user_cache
        invalidate_user_cache("nonexistent_user")  # Should not raise


# ---------------------------------------------------------------------------
# Profile CRUD endpoint tests
# ---------------------------------------------------------------------------

class TestProfilesRouter:
    """Test /api/profiles CRUD endpoints using user.sqlite."""

    def test_router_exists(self):
        """The profiles router should be registered on the app."""
        from app.main import app
        route_paths = [route.path for route in app.routes]
        assert "/api/profiles" in route_paths or any(
            p.startswith("/api/profiles") for p in route_paths
        )

    def test_list_profiles(self):
        """GET /api/profiles should return all profiles with current marker."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.user_db import ensure_user_database, create_profile, set_selected_profile_id

        uid = _uid("list")
        p1, p2 = uuid4().hex[:8], uuid4().hex[:8]
        ensure_user_database(uid)
        create_profile(uid, p1, "Marcus", "#3B82F6", is_default=True)
        create_profile(uid, p2, "Jordan", "#10B981")
        set_selected_profile_id(uid, p1)

        client = TestClient(app)
        response = client.get("/api/profiles", headers={"X-User-ID": uid, "X-Profile-ID": p1})

        assert response.status_code == 200
        data = response.json()
        assert "profiles" in data
        assert len(data["profiles"]) >= 2
        current = [p for p in data["profiles"] if p["isCurrent"]]
        assert len(current) == 1
        assert current[0]["id"] == p1

    @patch("app.routers.profiles.invalidate_user_cache")
    @patch("app.database.ensure_database")
    def test_create_profile(self, mock_ensure_db, mock_invalidate):
        """POST /api/profiles should create a new profile."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.user_db import ensure_user_database, create_profile, set_selected_profile_id

        uid = _uid("create")
        p1 = uuid4().hex[:8]
        ensure_user_database(uid)
        create_profile(uid, p1, "Marcus", "#3B82F6", is_default=True)
        set_selected_profile_id(uid, p1)

        client = TestClient(app)
        response = client.post(
            "/api/profiles", json={"name": "Jordan", "color": "#10B981"},
            headers={"X-User-ID": uid, "X-Profile-ID": p1},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Jordan"
        assert data["color"] == "#10B981"
        assert len(data["id"]) == 8

    def test_update_profile(self):
        """PUT /api/profiles/{id} should update profile name and color."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.user_db import ensure_user_database, create_profile, set_selected_profile_id

        uid = _uid("update")
        p1 = uuid4().hex[:8]
        ensure_user_database(uid)
        create_profile(uid, p1, "Marcus", "#3B82F6", is_default=True)
        set_selected_profile_id(uid, p1)

        client = TestClient(app)
        response = client.put(
            f"/api/profiles/{p1}", json={"name": "Marcus Jr.", "color": "#EF4444"},
            headers={"X-User-ID": uid, "X-Profile-ID": p1},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Marcus Jr."
        assert data["color"] == "#EF4444"

    def test_update_nonexistent_profile_returns_404(self):
        """PUT /api/profiles/{id} should return 404 for missing profile."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.user_db import ensure_user_database, create_profile, set_selected_profile_id

        uid = _uid("upd404")
        p1 = uuid4().hex[:8]
        ensure_user_database(uid)
        create_profile(uid, p1, "Marcus", "#3B82F6", is_default=True)
        set_selected_profile_id(uid, p1)

        client = TestClient(app)
        response = client.put(
            "/api/profiles/nonexistent", json={"name": "Test"},
            headers={"X-User-ID": uid, "X-Profile-ID": p1},
        )
        assert response.status_code == 404

    @patch("app.routers.profiles.invalidate_user_cache")
    def test_switch_profile(self, mock_invalidate):
        """PUT /api/profiles/current should switch the active profile."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.user_db import ensure_user_database, create_profile, set_selected_profile_id

        uid = _uid("switch")
        p1, p2 = uuid4().hex[:8], uuid4().hex[:8]
        ensure_user_database(uid)
        create_profile(uid, p1, "Marcus", "#3B82F6", is_default=True)
        create_profile(uid, p2, "Jordan", "#10B981")
        set_selected_profile_id(uid, p1)

        client = TestClient(app)
        response = client.put(
            "/api/profiles/current", json={"profileId": p2},
            headers={"X-User-ID": uid, "X-Profile-ID": p1},
        )

        assert response.status_code == 200
        assert response.json()["profileId"] == p2
        mock_invalidate.assert_called_once_with(uid)

    def test_switch_to_nonexistent_profile_returns_404(self):
        """PUT /api/profiles/current should return 404 for missing profile."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.user_db import ensure_user_database, create_profile, set_selected_profile_id

        uid = _uid("sw404")
        p1 = uuid4().hex[:8]
        ensure_user_database(uid)
        create_profile(uid, p1, "Marcus", "#3B82F6", is_default=True)
        set_selected_profile_id(uid, p1)

        client = TestClient(app)
        response = client.put(
            "/api/profiles/current", json={"profileId": "nonexistent"},
            headers={"X-User-ID": uid, "X-Profile-ID": p1},
        )
        assert response.status_code == 404

    @patch("app.routers.profiles.delete_profile_r2_data")
    @patch("app.routers.profiles.delete_local_profile_data")
    def test_delete_profile(self, mock_delete_local, mock_delete_r2):
        """DELETE /api/profiles/{id} should remove profile."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.user_db import ensure_user_database, create_profile, set_selected_profile_id

        uid = _uid("delete")
        p1, p2 = uuid4().hex[:8], uuid4().hex[:8]
        ensure_user_database(uid)
        create_profile(uid, p1, "Marcus", "#3B82F6", is_default=True)
        create_profile(uid, p2, "Jordan", "#10B981")
        set_selected_profile_id(uid, p1)

        client = TestClient(app)
        response = client.delete(f"/api/profiles/{p2}", headers={"X-User-ID": uid, "X-Profile-ID": p1})

        assert response.status_code == 200
        assert response.json()["deleted"] == p2

    def test_cannot_delete_last_profile(self):
        """DELETE /api/profiles/{id} should return 400 when only one profile exists."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.user_db import ensure_user_database, create_profile, set_selected_profile_id

        uid = _uid("last")
        p1 = uuid4().hex[:8]
        ensure_user_database(uid)
        create_profile(uid, p1, "Marcus", "#3B82F6", is_default=True)
        set_selected_profile_id(uid, p1)

        client = TestClient(app)
        response = client.delete(f"/api/profiles/{p1}", headers={"X-User-ID": uid, "X-Profile-ID": p1})

        assert response.status_code == 400
        assert "last profile" in response.json()["detail"].lower()

    @patch("app.routers.profiles.invalidate_user_cache")
    @patch("app.routers.profiles.delete_profile_r2_data")
    @patch("app.routers.profiles.delete_local_profile_data")
    def test_delete_current_profile_auto_switches(
        self, mock_delete_local, mock_delete_r2, mock_invalidate
    ):
        """Deleting the current profile should auto-switch to another."""
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.user_db import (
            ensure_user_database, create_profile, set_selected_profile_id, get_selected_profile_id,
        )

        uid = _uid("delcur")
        p1, p2 = uuid4().hex[:8], uuid4().hex[:8]
        ensure_user_database(uid)
        create_profile(uid, p1, "Marcus", "#3B82F6", is_default=True)
        create_profile(uid, p2, "Jordan", "#10B981")
        set_selected_profile_id(uid, p1)

        client = TestClient(app)
        response = client.delete(f"/api/profiles/{p1}", headers={"X-User-ID": uid, "X-Profile-ID": p1})

        assert response.status_code == 200
        new_selected = get_selected_profile_id(uid)
        assert new_selected == p2
        mock_invalidate.assert_called()
