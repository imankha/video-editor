"""
T85b: Tests for Profile Switching — Multi-Athlete Support

Tests for:
- Profile CRUD endpoints (list, create, update, delete)
- Profile switch endpoint
- Cannot delete last profile
- Profile isolation (separate DBs per profile)
- session_init cache invalidation

Run with: pytest tests/test_profiles.py -v
"""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock
import json

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


# ---------------------------------------------------------------------------
# Storage helper tests
# ---------------------------------------------------------------------------

class TestReadProfilesJson:
    """Test read_profiles_json() reads and parses profiles.json from R2."""

    @patch("app.storage.get_r2_sync_client")
    def test_returns_none_when_no_client(self, mock_client):
        """Should return None when R2 client is not available."""
        mock_client.return_value = None
        from app.storage import read_profiles_json
        assert read_profiles_json("testuser") is None

    @patch("app.storage.get_r2_sync_client")
    @patch("app.storage.APP_ENV", "dev")
    def test_returns_parsed_profiles(self, mock_client_fn):
        """Should download and parse profiles.json from R2."""
        profiles_data = {
            "default": "abc12345",
            "profiles": {
                "abc12345": {"name": "Marcus", "color": "#3B82F6"},
                "def67890": {"name": "Jordan", "color": "#10B981"},
            }
        }

        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client

        # Mock download_file to write JSON to the temp file
        def fake_download(bucket, key, path):
            with open(path, 'w') as f:
                json.dump(profiles_data, f)

        mock_client.download_file = fake_download

        from app.storage import read_profiles_json
        result = read_profiles_json("testuser")

        assert result is not None
        assert result["default"] == "abc12345"
        assert len(result["profiles"]) == 2
        assert result["profiles"]["abc12345"]["name"] == "Marcus"

    @patch("app.storage.get_r2_sync_client")
    @patch("app.storage.APP_ENV", "dev")
    def test_returns_none_on_missing_file(self, mock_client_fn):
        """Should return None when profiles.json doesn't exist in R2."""
        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client
        mock_client.exceptions.NoSuchKey = type('NoSuchKey', (Exception,), {})
        mock_client.download_file.side_effect = mock_client.exceptions.NoSuchKey()

        from app.storage import read_profiles_json
        result = read_profiles_json("testuser")
        assert result is None


class TestSaveProfilesJson:
    """Test save_profiles_json() writes profiles.json to R2."""

    @patch("app.storage.get_r2_client")
    @patch("app.storage.APP_ENV", "dev")
    def test_uploads_json_to_r2(self, mock_client_fn):
        """Should upload the full profiles dict as JSON to R2."""
        mock_client = MagicMock()
        mock_client_fn.return_value = mock_client

        profiles_data = {
            "default": "abc12345",
            "profiles": {
                "abc12345": {"name": "Marcus", "color": "#3B82F6"},
            }
        }

        from app.storage import save_profiles_json
        result = save_profiles_json("testuser", profiles_data)

        assert result is True
        mock_client.put_object.assert_called_once()
        call_kwargs = mock_client.put_object.call_args
        assert call_kwargs[1]["Key"] == "dev/users/testuser/profiles.json"
        body = json.loads(call_kwargs[1]["Body"])
        assert body["default"] == "abc12345"

    @patch("app.storage.get_r2_client")
    def test_returns_false_when_no_client(self, mock_client_fn):
        """Should return False when R2 client is not available."""
        mock_client_fn.return_value = None
        from app.storage import save_profiles_json
        assert save_profiles_json("testuser", {}) is False


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
    """Test /api/profiles CRUD endpoints."""

    def test_router_exists(self):
        """The profiles router should be registered on the app."""
        from app.main import app
        route_paths = [route.path for route in app.routes]
        assert "/api/profiles" in route_paths or any(
            p.startswith("/api/profiles") for p in route_paths
        )

    @patch("app.routers.profiles.read_profiles_json")
    @patch("app.routers.profiles.read_selected_profile_from_r2")
    def test_list_profiles(self, mock_selected, mock_profiles):
        """GET /api/profiles should return all profiles with current marker."""
        mock_profiles.return_value = {
            "default": "abc12345",
            "profiles": {
                "abc12345": {"name": "Marcus", "color": "#3B82F6"},
                "def67890": {"name": "Jordan", "color": "#10B981"},
            }
        }
        mock_selected.return_value = "abc12345"

        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        response = client.get(
            "/api/profiles",
            headers={"X-User-ID": "testuser", "X-Profile-ID": "abc12345"}
        )

        assert response.status_code == 200
        data = response.json()
        assert "profiles" in data
        assert len(data["profiles"]) == 2

        # Check current profile is marked
        current = [p for p in data["profiles"] if p["isCurrent"]]
        assert len(current) == 1
        assert current[0]["id"] == "abc12345"

    @patch("app.routers.profiles.read_profiles_json")
    @patch("app.routers.profiles.save_profiles_json")
    @patch("app.routers.profiles.upload_selected_profile_json")
    @patch("app.routers.profiles.invalidate_user_cache")
    @patch("app.database.ensure_database")
    def test_create_profile(self, mock_ensure_db, mock_invalidate, mock_upload_selected, mock_save, mock_read):
        """POST /api/profiles should create a new profile."""
        mock_read.return_value = {
            "default": "abc12345",
            "profiles": {
                "abc12345": {"name": "Marcus", "color": "#3B82F6"},
            }
        }
        mock_save.return_value = True
        mock_upload_selected.return_value = True

        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        response = client.post(
            "/api/profiles",
            json={"name": "Jordan", "color": "#10B981"},
            headers={"X-User-ID": "testuser", "X-Profile-ID": "abc12345"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Jordan"
        assert data["color"] == "#10B981"
        assert "id" in data
        assert len(data["id"]) == 8  # uuid4().hex[:8]

        # Verify profiles.json was saved with new profile
        mock_save.assert_called_once()
        saved_data = mock_save.call_args[0][1]
        assert len(saved_data["profiles"]) == 2

    @patch("app.routers.profiles.read_profiles_json")
    @patch("app.routers.profiles.save_profiles_json")
    def test_update_profile(self, mock_save, mock_read):
        """PUT /api/profiles/{id} should update profile name and color."""
        mock_read.return_value = {
            "default": "abc12345",
            "profiles": {
                "abc12345": {"name": "Marcus", "color": "#3B82F6"},
            }
        }
        mock_save.return_value = True

        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        response = client.put(
            "/api/profiles/abc12345",
            json={"name": "Marcus Jr.", "color": "#EF4444"},
            headers={"X-User-ID": "testuser", "X-Profile-ID": "abc12345"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Marcus Jr."
        assert data["color"] == "#EF4444"

    @patch("app.routers.profiles.read_profiles_json")
    @patch("app.routers.profiles.save_profiles_json")
    def test_update_nonexistent_profile_returns_404(self, mock_save, mock_read):
        """PUT /api/profiles/{id} should return 404 for missing profile."""
        mock_read.return_value = {
            "default": "abc12345",
            "profiles": {
                "abc12345": {"name": "Marcus", "color": "#3B82F6"},
            }
        }

        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        response = client.put(
            "/api/profiles/nonexistent",
            json={"name": "Test"},
            headers={"X-User-ID": "testuser", "X-Profile-ID": "abc12345"}
        )

        assert response.status_code == 404

    @patch("app.routers.profiles.read_profiles_json")
    @patch("app.routers.profiles.read_selected_profile_from_r2")
    @patch("app.routers.profiles.upload_selected_profile_json")
    @patch("app.routers.profiles.invalidate_user_cache")
    def test_switch_profile(self, mock_invalidate, mock_upload, mock_selected, mock_read):
        """PUT /api/profiles/current should switch the active profile."""
        mock_read.return_value = {
            "default": "abc12345",
            "profiles": {
                "abc12345": {"name": "Marcus", "color": "#3B82F6"},
                "def67890": {"name": "Jordan", "color": "#10B981"},
            }
        }
        mock_selected.return_value = "abc12345"
        mock_upload.return_value = True

        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        response = client.put(
            "/api/profiles/current",
            json={"profileId": "def67890"},
            headers={"X-User-ID": "testuser", "X-Profile-ID": "abc12345"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["profileId"] == "def67890"
        mock_upload.assert_called_once_with("testuser", "def67890")
        mock_invalidate.assert_called_once_with("testuser")

    @patch("app.routers.profiles.read_profiles_json")
    def test_switch_to_nonexistent_profile_returns_404(self, mock_read):
        """PUT /api/profiles/current should return 404 for missing profile."""
        mock_read.return_value = {
            "default": "abc12345",
            "profiles": {
                "abc12345": {"name": "Marcus", "color": "#3B82F6"},
            }
        }

        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        response = client.put(
            "/api/profiles/current",
            json={"profileId": "nonexistent"},
            headers={"X-User-ID": "testuser", "X-Profile-ID": "abc12345"}
        )

        assert response.status_code == 404

    @patch("app.routers.profiles.read_profiles_json")
    @patch("app.routers.profiles.read_selected_profile_from_r2")
    @patch("app.routers.profiles.save_profiles_json")
    @patch("app.routers.profiles.delete_profile_r2_data")
    @patch("app.routers.profiles.delete_local_profile_data")
    def test_delete_profile(self, mock_delete_local, mock_delete_r2, mock_save, mock_selected, mock_read):
        """DELETE /api/profiles/{id} should remove profile and its data."""
        mock_read.return_value = {
            "default": "abc12345",
            "profiles": {
                "abc12345": {"name": "Marcus", "color": "#3B82F6"},
                "def67890": {"name": "Jordan", "color": "#10B981"},
            }
        }
        mock_selected.return_value = "abc12345"
        mock_save.return_value = True

        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        response = client.delete(
            "/api/profiles/def67890",
            headers={"X-User-ID": "testuser", "X-Profile-ID": "abc12345"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["deleted"] == "def67890"

        # Verify profile was removed from profiles.json
        saved_data = mock_save.call_args[0][1]
        assert "def67890" not in saved_data["profiles"]
        assert len(saved_data["profiles"]) == 1

    @patch("app.routers.profiles.read_profiles_json")
    def test_cannot_delete_last_profile(self, mock_read):
        """DELETE /api/profiles/{id} should return 400 when only one profile exists."""
        mock_read.return_value = {
            "default": "abc12345",
            "profiles": {
                "abc12345": {"name": "Marcus", "color": "#3B82F6"},
            }
        }

        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        response = client.delete(
            "/api/profiles/abc12345",
            headers={"X-User-ID": "testuser", "X-Profile-ID": "abc12345"}
        )

        assert response.status_code == 400
        assert "last profile" in response.json()["detail"].lower()

    @patch("app.routers.profiles.read_profiles_json")
    @patch("app.routers.profiles.read_selected_profile_from_r2")
    @patch("app.routers.profiles.upload_selected_profile_json")
    @patch("app.routers.profiles.save_profiles_json")
    @patch("app.routers.profiles.invalidate_user_cache")
    @patch("app.routers.profiles.delete_profile_r2_data")
    @patch("app.routers.profiles.delete_local_profile_data")
    def test_delete_current_profile_auto_switches(
        self, mock_delete_local, mock_delete_r2, mock_invalidate,
        mock_save, mock_upload, mock_selected, mock_read
    ):
        """Deleting the current profile should auto-switch to another."""
        mock_read.return_value = {
            "default": "abc12345",
            "profiles": {
                "abc12345": {"name": "Marcus", "color": "#3B82F6"},
                "def67890": {"name": "Jordan", "color": "#10B981"},
            }
        }
        mock_selected.return_value = "abc12345"  # Current profile is the one being deleted
        mock_save.return_value = True
        mock_upload.return_value = True

        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        response = client.delete(
            "/api/profiles/abc12345",
            headers={"X-User-ID": "testuser", "X-Profile-ID": "abc12345"}
        )

        assert response.status_code == 200
        # Should have switched to the other profile
        mock_upload.assert_called_once_with("testuser", "def67890")
        mock_invalidate.assert_called_once()
