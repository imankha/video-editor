"""
T930: Tests for resilient R2 sync — marker file persistence and retry.

Verifies:
  - mark_sync_pending creates .sync_pending file
  - has_sync_pending returns True when marker exists
  - clear_sync_pending removes marker, has_sync_pending returns False
  - clear_sync_pending is idempotent (no error when file missing)
  - retry_pending_sync calls the correct sync functions

Run with: pytest tests/test_sync_retry.py -v
"""

import pytest
import sys
import time
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import (
    mark_sync_pending,
    clear_sync_pending,
    has_sync_pending,
    _sync_pending_path,
    USER_DATA_BASE,
)


@pytest.fixture
def tmp_user(tmp_path, monkeypatch):
    """Patch USER_DATA_BASE to a temp directory and return a test user_id."""
    import app.database as db_module
    monkeypatch.setattr(db_module, "USER_DATA_BASE", tmp_path)
    user_id = "test-user-sync-retry"
    return user_id, tmp_path


class TestSyncPendingMarker:
    """Unit tests for .sync_pending marker file operations."""

    def test_mark_creates_file(self, tmp_user):
        user_id, base = tmp_user
        assert not has_sync_pending(user_id)

        mark_sync_pending(user_id)

        assert has_sync_pending(user_id)
        marker_path = base / user_id / ".sync_pending"
        assert marker_path.exists()
        # Contents should be a timestamp
        content = marker_path.read_text()
        ts = float(content)
        assert ts > 0

    def test_clear_removes_file(self, tmp_user):
        user_id, base = tmp_user
        mark_sync_pending(user_id)
        assert has_sync_pending(user_id)

        clear_sync_pending(user_id)

        assert not has_sync_pending(user_id)
        marker_path = base / user_id / ".sync_pending"
        assert not marker_path.exists()

    def test_clear_idempotent(self, tmp_user):
        """Clearing when no marker exists should not raise."""
        user_id, _ = tmp_user
        # No marker set — should not raise
        clear_sync_pending(user_id)
        assert not has_sync_pending(user_id)

    def test_has_sync_pending_false_by_default(self, tmp_user):
        user_id, _ = tmp_user
        assert not has_sync_pending(user_id)

    def test_mark_creates_user_directory(self, tmp_user):
        """mark_sync_pending should create the user directory if it doesn't exist."""
        user_id, base = tmp_user
        user_dir = base / user_id
        assert not user_dir.exists()

        mark_sync_pending(user_id)

        assert user_dir.exists()
        assert has_sync_pending(user_id)

    def test_mark_overwrites_previous(self, tmp_user):
        """A second mark should update the timestamp."""
        user_id, base = tmp_user
        mark_sync_pending(user_id)
        marker_path = base / user_id / ".sync_pending"
        first_ts = float(marker_path.read_text())

        # Small delay so timestamp differs
        time.sleep(0.01)
        mark_sync_pending(user_id)
        second_ts = float(marker_path.read_text())

        assert second_ts >= first_ts


class TestRetryPendingSync:
    """Tests for retry_pending_sync in the middleware."""

    @patch("app.storage.sync_user_db_to_r2_with_version", return_value=(True, 2))
    @patch("app.storage.sync_database_to_r2_with_version", return_value=(True, 2))
    @patch("app.profile_context.get_current_profile_id", return_value="abcd1234")
    @patch("app.storage.R2_ENABLED", True)
    def test_retry_success(self, mock_profile, mock_db_sync, mock_user_sync, tmp_user):
        from app.middleware.db_sync import retry_pending_sync
        user_id, base = tmp_user

        # Create fake DB files
        profile_dir = base / user_id / "profiles" / "abcd1234"
        profile_dir.mkdir(parents=True)
        (profile_dir / "database.sqlite").write_text("fake")
        (base / user_id / "user.sqlite").write_text("fake")

        # Patch database functions that are imported locally inside retry_pending_sync
        with patch("app.database.get_database_path", return_value=profile_dir / "database.sqlite"), \
             patch("app.database.get_local_db_version", return_value=1), \
             patch("app.database.set_local_db_version") as mock_set_ver, \
             patch("app.database.get_local_user_db_version", return_value=1), \
             patch("app.database.set_local_user_db_version") as mock_set_user_ver, \
             patch("app.database.USER_DATA_BASE", base):
            result = retry_pending_sync(user_id)

        assert result is True
        mock_set_ver.assert_called_once_with(user_id, "abcd1234", 2)
        mock_set_user_ver.assert_called_once_with(user_id, 2)

    @patch("app.storage.sync_database_to_r2_with_version", return_value=(False, None))
    @patch("app.profile_context.get_current_profile_id", return_value="abcd1234")
    @patch("app.storage.R2_ENABLED", True)
    def test_retry_failure(self, mock_profile, mock_db_sync, tmp_user):
        from app.middleware.db_sync import retry_pending_sync
        user_id, base = tmp_user

        profile_dir = base / user_id / "profiles" / "abcd1234"
        profile_dir.mkdir(parents=True)
        (profile_dir / "database.sqlite").write_text("fake")

        with patch("app.database.get_database_path", return_value=profile_dir / "database.sqlite"), \
             patch("app.database.get_local_db_version", return_value=1), \
             patch("app.database.set_local_db_version"), \
             patch("app.database.get_local_user_db_version", return_value=None), \
             patch("app.database.set_local_user_db_version"), \
             patch("app.database.USER_DATA_BASE", base):
            result = retry_pending_sync(user_id)

        assert result is False
