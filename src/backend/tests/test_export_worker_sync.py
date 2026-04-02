"""
Tests for T940: Export worker R2 sync functions.

Verifies that sync_db_to_r2_explicit and sync_user_db_to_r2_explicit
call the correct storage functions with correct arguments.
"""

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock


class TestSyncDbToR2Explicit:
    """Test sync_db_to_r2_explicit calls storage with correct args."""

    @patch("app.database.R2_ENABLED", False)
    def test_returns_true_when_r2_disabled(self):
        from app.database import sync_db_to_r2_explicit
        assert sync_db_to_r2_explicit("user1", "profile1") is True

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.USER_DATA_BASE", Path("/fake/user_data"))
    def test_returns_true_when_db_not_exists(self):
        from app.database import sync_db_to_r2_explicit
        # Path won't exist, so should return True early
        assert sync_db_to_r2_explicit("user1", "profile1") is True

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.sync_database_to_r2_with_version")
    @patch("app.database.get_local_db_version", return_value=5)
    @patch("app.database.set_local_db_version")
    def test_calls_sync_with_correct_args(
        self, mock_set_version, mock_get_version, mock_sync, tmp_path
    ):
        from app.database import sync_db_to_r2_explicit

        # Create a fake database file
        db_dir = tmp_path / "testuser" / "profiles" / "testprofile"
        db_dir.mkdir(parents=True)
        db_file = db_dir / "database.sqlite"
        db_file.write_text("fake")

        mock_sync.return_value = (True, 6)

        with patch("app.database.USER_DATA_BASE", tmp_path):
            result = sync_db_to_r2_explicit("testuser", "testprofile")

        assert result is True
        mock_get_version.assert_called_once_with("testuser", "testprofile")
        mock_sync.assert_called_once_with("testuser", db_file, 5)
        mock_set_version.assert_called_once_with("testuser", "testprofile", 6)

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.sync_database_to_r2_with_version")
    @patch("app.database.get_local_db_version", return_value=3)
    @patch("app.database.set_local_db_version")
    def test_returns_false_on_sync_failure(
        self, mock_set_version, mock_get_version, mock_sync, tmp_path
    ):
        from app.database import sync_db_to_r2_explicit

        db_dir = tmp_path / "testuser" / "profiles" / "testprofile"
        db_dir.mkdir(parents=True)
        (db_dir / "database.sqlite").write_text("fake")

        mock_sync.return_value = (False, None)

        with patch("app.database.USER_DATA_BASE", tmp_path):
            result = sync_db_to_r2_explicit("testuser", "testprofile")

        assert result is False
        mock_set_version.assert_not_called()


class TestSyncUserDbToR2Explicit:
    """Test sync_user_db_to_r2_explicit calls storage with correct args."""

    @patch("app.database.R2_ENABLED", False)
    def test_returns_true_when_r2_disabled(self):
        from app.database import sync_user_db_to_r2_explicit
        assert sync_user_db_to_r2_explicit("user1") is True

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.USER_DATA_BASE", Path("/fake/user_data"))
    def test_returns_true_when_db_not_exists(self):
        from app.database import sync_user_db_to_r2_explicit
        assert sync_user_db_to_r2_explicit("user1") is True

    @patch("app.database.R2_ENABLED", True)
    @patch("app.storage.sync_user_db_to_r2_with_version")
    @patch("app.database.get_local_user_db_version", return_value=10)
    @patch("app.database.set_local_user_db_version")
    def test_calls_sync_with_correct_args(
        self, mock_set_version, mock_get_version, mock_sync, tmp_path
    ):
        from app.database import sync_user_db_to_r2_explicit

        db_dir = tmp_path / "testuser"
        db_dir.mkdir(parents=True)
        db_file = db_dir / "user.sqlite"
        db_file.write_text("fake")

        mock_sync.return_value = (True, 11)

        with patch("app.database.USER_DATA_BASE", tmp_path):
            result = sync_user_db_to_r2_explicit("testuser")

        assert result is True
        mock_get_version.assert_called_once_with("testuser")
        mock_sync.assert_called_once_with("testuser", db_file, 10)
        mock_set_version.assert_called_once_with("testuser", 11)

    @patch("app.database.R2_ENABLED", True)
    @patch("app.storage.sync_user_db_to_r2_with_version")
    @patch("app.database.get_local_user_db_version", return_value=7)
    @patch("app.database.set_local_user_db_version")
    def test_returns_false_on_sync_failure(
        self, mock_set_version, mock_get_version, mock_sync, tmp_path
    ):
        from app.database import sync_user_db_to_r2_explicit

        db_dir = tmp_path / "testuser"
        db_dir.mkdir(parents=True)
        (db_dir / "user.sqlite").write_text("fake")

        mock_sync.return_value = (False, None)

        with patch("app.database.USER_DATA_BASE", tmp_path):
            result = sync_user_db_to_r2_explicit("testuser")

        assert result is False
        mock_set_version.assert_not_called()
