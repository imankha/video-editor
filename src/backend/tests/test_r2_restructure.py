"""
T85a: Tests for R2 Restructure — Environment + Profiles Path Layout

Tests for:
- r2_key() produces {env}/users/{user_id}/profiles/{profile_id}/{path}
- r2_global_key() produces {env}/{path}
- r2_user_key() produces {env}/users/{user_id}/{path}
- profile_context ContextVar (get/set/reset/raises)
- get_user_data_path() includes profile segment
- user_session_init() creates profile for new users
- user_session_init() loads existing profile
- /api/auth/init endpoint returns profile_id

Run with: pytest tests/test_r2_restructure.py -v
"""

import sys
from pathlib import Path
from unittest.mock import patch, MagicMock
from uuid import uuid4
import json

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


# ---------------------------------------------------------------------------
# profile_context tests
# ---------------------------------------------------------------------------

class TestProfileContext:
    """Test profile_context ContextVar get/set/reset behavior."""

    def test_get_raises_when_not_set(self):
        """get_current_profile_id() should raise RuntimeError when no profile is set."""
        from app.profile_context import get_current_profile_id, reset_profile_id
        reset_profile_id()
        with pytest.raises(RuntimeError, match="Profile ID not set"):
            get_current_profile_id()

    def test_set_and_get(self):
        """set_current_profile_id() should make the value readable via get."""
        from app.profile_context import (
            get_current_profile_id, set_current_profile_id, reset_profile_id
        )
        try:
            set_current_profile_id("abc123")
            assert get_current_profile_id() == "abc123"
        finally:
            reset_profile_id()

    def test_reset_clears(self):
        """reset_profile_id() should clear the value, making get raise again."""
        from app.profile_context import (
            get_current_profile_id, set_current_profile_id, reset_profile_id
        )
        set_current_profile_id("abc123")
        reset_profile_id()
        with pytest.raises(RuntimeError):
            get_current_profile_id()


# ---------------------------------------------------------------------------
# r2_key / r2_global_key / r2_user_key tests
# ---------------------------------------------------------------------------

class TestR2KeyFormat:
    """Test that r2_key() produces the new env/users/profiles format."""

    def setup_method(self):
        """Set up profile context for each test."""
        from app.profile_context import set_current_profile_id
        set_current_profile_id("testprof")

    def teardown_method(self):
        """Clean up profile context."""
        from app.profile_context import reset_profile_id
        reset_profile_id()

    @patch("app.storage.APP_ENV", "dev")
    def test_r2_key_dev_format(self):
        """r2_key should produce dev/users/{user_id}/profiles/{profile_id}/{path}."""
        from app.storage import r2_key
        result = r2_key("myuser", "raw_clips/video.mp4")
        assert result == "dev/users/myuser/profiles/testprof/raw_clips/video.mp4"

    @patch("app.storage.APP_ENV", "prod")
    def test_r2_key_prod_format(self):
        """r2_key should respect APP_ENV."""
        from app.storage import r2_key
        result = r2_key("myuser", "database.sqlite")
        assert result == "prod/users/myuser/profiles/testprof/database.sqlite"

    @patch("app.storage.APP_ENV", "dev")
    def test_r2_key_normalizes_backslashes(self):
        """r2_key should normalize Windows backslashes."""
        from app.storage import r2_key
        result = r2_key("myuser", "raw_clips\\video.mp4")
        assert result == "dev/users/myuser/profiles/testprof/raw_clips/video.mp4"

    @patch("app.storage.APP_ENV", "dev")
    def test_r2_key_nested_path(self):
        """r2_key should handle nested relative paths."""
        from app.storage import r2_key
        result = r2_key("user_a", "working_videos/project_1/clip.mp4")
        assert result == "dev/users/user_a/profiles/testprof/working_videos/project_1/clip.mp4"


class TestR2GlobalKeyFormat:
    """Test that r2_global_key() produces the new env-prefixed format."""

    @patch("app.storage.APP_ENV", "dev")
    def test_r2_global_key_dev(self):
        """r2_global_key should produce dev/{path}."""
        from app.storage import r2_global_key
        assert r2_global_key("games/test.mp4") == "dev/games/test.mp4"

    @patch("app.storage.APP_ENV", "prod")
    def test_r2_global_key_prod(self):
        """r2_global_key should respect APP_ENV."""
        from app.storage import r2_global_key
        assert r2_global_key("games/test.mp4") == "prod/games/test.mp4"

    @patch("app.storage.APP_ENV", "dev")
    def test_r2_global_key_normalizes_backslashes(self):
        """r2_global_key should normalize Windows backslashes."""
        from app.storage import r2_global_key
        assert r2_global_key("games\\test.mp4") == "dev/games/test.mp4"


class TestR2UserKeyFormat:
    """Test that r2_user_key() produces env/users/{user_id}/{path} (no profile)."""

    @patch("app.storage.APP_ENV", "dev")
    def test_r2_user_key_format(self):
        """r2_user_key should produce user-level path without profile."""
        from app.storage import r2_user_key
        assert r2_user_key("myuser", "user.sqlite") == "dev/users/myuser/user.sqlite"

    @patch("app.storage.APP_ENV", "staging")
    def test_r2_user_key_staging(self):
        """r2_user_key should respect APP_ENV."""
        from app.storage import r2_user_key
        result = r2_user_key("myuser", "user.sqlite")
        assert result == "staging/users/myuser/user.sqlite"


# ---------------------------------------------------------------------------
# get_user_data_path tests
# ---------------------------------------------------------------------------

class TestUserDataPath:
    """Test that local paths include profile segment."""

    def setup_method(self):
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id
        set_current_user_id("testuser")
        set_current_profile_id("prof123")

    def teardown_method(self):
        from app.profile_context import reset_profile_id
        from app.user_context import reset_user_id
        reset_profile_id()
        reset_user_id()

    def test_user_data_path_includes_profile(self):
        """get_user_data_path() should return .../testuser/profiles/prof123."""
        from app.database import get_user_data_path
        path = get_user_data_path()
        # Check the path ends with the expected segments
        parts = path.parts
        assert parts[-3] == "testuser"
        assert parts[-2] == "profiles"
        assert parts[-1] == "prof123"

    def test_database_path_under_profile(self):
        """get_database_path() should be under the profile directory."""
        from app.database import get_database_path
        path = get_database_path()
        parts = path.parts
        assert parts[-4] == "testuser"
        assert parts[-3] == "profiles"
        assert parts[-2] == "prof123"
        assert parts[-1] == "database.sqlite"

    def test_raw_clips_path_under_profile(self):
        """get_raw_clips_path() should be under the profile directory."""
        from app.database import get_raw_clips_path
        path = get_raw_clips_path()
        parts = path.parts
        assert parts[-3] == "profiles"
        assert parts[-2] == "prof123"
        assert parts[-1] == "raw_clips"


# ---------------------------------------------------------------------------
# user_session_init tests
# ---------------------------------------------------------------------------

class TestUserSessionInit:
    """Test user_session_init() profile creation and loading."""

    def teardown_method(self):
        """Clean up contexts."""
        from app.profile_context import reset_profile_id
        from app.user_context import reset_user_id
        reset_profile_id()
        reset_user_id()

    def test_creates_profile_for_new_user(self):
        """Should create a profile ID and return it for new users."""
        from app.session_init import user_session_init, _init_cache
        from app.user_context import set_current_user_id
        from app.profile_context import get_current_profile_id

        uid = f"test_new_{uuid4().hex[:8]}"
        set_current_user_id(uid)
        _init_cache.pop(uid, None)
        result = user_session_init(uid)

        assert "profile_id" in result
        assert len(result["profile_id"]) == 8
        assert result["is_new_user"] is True
        assert get_current_profile_id() == result["profile_id"]

    def test_loads_existing_profile_from_user_sqlite(self):
        """Should load existing profile from user.sqlite."""
        from app.session_init import user_session_init, _init_cache
        from app.user_context import set_current_user_id
        from app.profile_context import get_current_profile_id
        from app.services.user_db import (
            ensure_user_database, create_profile, set_selected_profile_id,
        )

        uid = f"test_existing_{uuid4().hex[:8]}"
        pid = uuid4().hex[:8]
        set_current_user_id(uid)
        _init_cache.pop(uid, None)
        ensure_user_database(uid)
        create_profile(uid, pid, "Test", "#000000")
        set_selected_profile_id(uid, pid)

        result = user_session_init(uid)

        assert result["profile_id"] == pid
        assert result["is_new_user"] is False
        assert get_current_profile_id() == pid

    def test_creates_profile_for_brand_new_user(self):
        """When no profile exists, should create one."""
        from app.session_init import user_session_init, _init_cache
        from app.user_context import set_current_user_id

        uid = f"test_brand_new_{uuid4().hex[:8]}"
        set_current_user_id(uid)
        _init_cache.pop(uid, None)

        result = user_session_init(uid)

        assert result["is_new_user"] is True
        assert len(result["profile_id"]) == 8


# ---------------------------------------------------------------------------
# /api/auth/init endpoint tests
# ---------------------------------------------------------------------------

class TestAuthInitEndpoint:
    """Test the /api/auth/init endpoint."""

    def test_init_endpoint_exists(self):
        """The /api/auth/init endpoint should exist on the app."""
        from app.routers.auth import router
        route_paths = [route.path for route in router.routes]
        # Router routes include the prefix in their paths
        assert "/api/auth/init" in route_paths

    @patch("app.routers.auth.user_session_init")
    def test_init_returns_profile_id(self, mock_init):
        """POST /api/auth/init should return user_id and profile_id."""
        from fastapi.testclient import TestClient
        from app.main import app

        mock_init.return_value = {
            "profile_id": "test1234",
            "is_new_user": True,
        }

        client = TestClient(app)
        response = client.post(
            "/api/auth/init",
            headers={"X-User-ID": "testuser"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["user_id"] == "testuser"
        assert data["profile_id"] == "test1234"
        assert data["is_new_user"] is True
