"""
Tests for T940: Export Worker R2 Sync.

Covers:
- sync_db_to_r2_explicit: explicit (non-context-var) sync for background workers
- sync_user_db_to_r2_explicit: same pattern for user.sqlite
- _sync_after_export: orchestrates both syncs after export job completion
"""

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest


def _patch_path_exists(target_path):
    """Return a patch that makes Path.exists() return True for any path matching target_path."""
    original_exists = Path.exists

    def _exists(self):
        if str(self) == str(target_path):
            return True
        return original_exists(self)

    return patch.object(Path, "exists", _exists)


# ---------------------------------------------------------------------------
# 1. sync_db_to_r2_explicit — calls sync_database_to_r2_with_version correctly
# ---------------------------------------------------------------------------

class TestSyncDbToR2Explicit:
    """Tests for the explicit profile-DB sync (no ContextVar dependency)."""

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.sync_database_to_r2_with_version")
    @patch("app.database.get_local_db_version", return_value=5)
    @patch("app.database.check_database_size")
    def test_calls_with_correct_args(self, mock_check_size, mock_get_ver, mock_sync):
        """sync_db_to_r2_explicit passes user_id, db_path, and current version."""
        from app.database import sync_db_to_r2_explicit

        mock_sync.return_value = (True, 6)
        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "profiles" / "p1" / "profile.sqlite"

        with patch("app.database.get_user_data_path_explicit", return_value=db_path.parent), \
             _patch_path_exists(db_path):
            result = sync_db_to_r2_explicit("u1", "p1")

        mock_sync.assert_called_once_with("u1", db_path, 5, skip_version_check=True)
        assert result is True

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.sync_database_to_r2_with_version")
    @patch("app.database.get_local_db_version", return_value=3)
    @patch("app.database.check_database_size")
    def test_returns_true_on_success_and_updates_version(self, mock_check, mock_get_ver, mock_sync):
        """On success, returns True and updates the local version cache."""
        from app.database import sync_db_to_r2_explicit

        mock_sync.return_value = (True, 4)
        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "profiles" / "p1" / "profile.sqlite"

        with patch("app.database.get_user_data_path_explicit", return_value=db_path.parent), \
             _patch_path_exists(db_path), \
             patch("app.database.set_local_db_version") as mock_set_ver:
            result = sync_db_to_r2_explicit("u1", "p1")

        assert result is True
        mock_set_ver.assert_called_once_with("u1", "p1", 4)

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.sync_database_to_r2_with_version")
    @patch("app.database.get_local_db_version", return_value=3)
    @patch("app.database.check_database_size")
    def test_returns_false_on_failure_no_version_update(self, mock_check, mock_get_ver, mock_sync):
        """On failure, returns False and does NOT update the local version."""
        from app.database import sync_db_to_r2_explicit

        mock_sync.return_value = (False, None)
        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "profiles" / "p1" / "profile.sqlite"

        with patch("app.database.get_user_data_path_explicit", return_value=db_path.parent), \
             _patch_path_exists(db_path), \
             patch("app.database.set_local_db_version") as mock_set_ver:
            result = sync_db_to_r2_explicit("u1", "p1")

        assert result is False
        mock_set_ver.assert_not_called()

    @patch("app.database.R2_ENABLED", False)
    def test_returns_true_if_r2_disabled(self):
        """When R2 is not enabled, sync is a no-op returning True."""
        from app.database import sync_db_to_r2_explicit

        result = sync_db_to_r2_explicit("u1", "p1")
        assert result is True


# ---------------------------------------------------------------------------
# 2. sync_user_db_to_r2_explicit — same pattern for user.sqlite
# ---------------------------------------------------------------------------

class TestSyncUserDbToR2Explicit:
    """Tests for the explicit user-DB sync (no ContextVar dependency)."""

    @patch("app.database.get_local_user_db_version", return_value=2)
    def test_calls_with_correct_args(self, mock_get_ver):
        """sync_user_db_to_r2_explicit passes user_id, db_path, and version."""
        from app.database import sync_user_db_to_r2_explicit

        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "user.sqlite"

        with patch("app.database.R2_ENABLED", True), \
             patch("app.database.USER_DATA_BASE", fake_base), \
             _patch_path_exists(db_path), \
             patch("app.storage.sync_user_db_to_r2_with_version") as mock_sync:
            mock_sync.return_value = (True, 3)
            result = sync_user_db_to_r2_explicit("u1")

        mock_sync.assert_called_once_with("u1", db_path, 2, skip_version_check=True)
        assert result is True

    @patch("app.database.get_local_user_db_version", return_value=2)
    def test_returns_true_on_success_updates_version(self, mock_get_ver):
        """On success, returns True and updates the local user-db version."""
        from app.database import sync_user_db_to_r2_explicit

        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "user.sqlite"

        with patch("app.database.R2_ENABLED", True), \
             patch("app.database.USER_DATA_BASE", fake_base), \
             _patch_path_exists(db_path), \
             patch("app.storage.sync_user_db_to_r2_with_version", return_value=(True, 3)), \
             patch("app.database.set_local_user_db_version") as mock_set_ver:
            result = sync_user_db_to_r2_explicit("u1")

        assert result is True
        mock_set_ver.assert_called_once_with("u1", 3)

    @patch("app.database.get_local_user_db_version", return_value=2)
    def test_returns_false_on_failure_no_version_update(self, mock_get_ver):
        """On failure, returns False and does NOT update the local version."""
        from app.database import sync_user_db_to_r2_explicit

        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "user.sqlite"

        with patch("app.database.R2_ENABLED", True), \
             patch("app.database.USER_DATA_BASE", fake_base), \
             _patch_path_exists(db_path), \
             patch("app.storage.sync_user_db_to_r2_with_version", return_value=(False, None)), \
             patch("app.database.set_local_user_db_version") as mock_set_ver:
            result = sync_user_db_to_r2_explicit("u1")

        assert result is False
        mock_set_ver.assert_not_called()

    @patch("app.database.R2_ENABLED", False)
    def test_returns_true_if_r2_disabled(self):
        """When R2 is not enabled, sync is a no-op returning True."""
        from app.database import sync_user_db_to_r2_explicit

        result = sync_user_db_to_r2_explicit("u1")
        assert result is True


# ---------------------------------------------------------------------------
# 3. _sync_after_export — orchestrates both syncs
# ---------------------------------------------------------------------------

class TestSyncAfterExport:
    """Tests for the export worker's post-export sync orchestrator."""

    @patch("app.database.sync_user_db_to_r2_explicit")
    @patch("app.database.sync_db_to_r2_explicit")
    def test_calls_both_syncs_when_credit_user_id_present(self, mock_db_sync, mock_user_sync):
        """When config has credit_user_id, syncs both profile DB and user DB."""
        from app.services.export_worker import _sync_after_export

        mock_db_sync.return_value = True
        mock_user_sync.return_value = True

        config = {"credit_user_id": "u1"}
        _sync_after_export("u1", "p1", config)

        mock_db_sync.assert_called_once_with("u1", "p1")
        mock_user_sync.assert_called_once_with("u1")

    @patch("app.database.sync_user_db_to_r2_explicit")
    @patch("app.database.sync_db_to_r2_explicit")
    def test_only_profile_sync_when_no_credit_user_id(self, mock_db_sync, mock_user_sync):
        """When config has no credit_user_id, only syncs profile DB."""
        from app.services.export_worker import _sync_after_export

        mock_db_sync.return_value = True

        config = {}
        _sync_after_export("u1", "p1", config)

        mock_db_sync.assert_called_once_with("u1", "p1")
        mock_user_sync.assert_not_called()
