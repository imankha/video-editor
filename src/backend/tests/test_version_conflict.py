"""
T950: Version conflict detection tests for sync_database_to_r2_with_version
and sync_user_db_to_r2_with_version.
"""

import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

from app.storage import (
    sync_database_to_r2_with_version,
    sync_user_db_to_r2_with_version,
    R2VersionResult,
)

MODULE = "app.storage"
RETRY_MODULE = "app.utils.retry"


@pytest.fixture
def local_db(tmp_path):
    """Create a fake local DB file."""
    db = tmp_path / "profile.sqlite"
    db.write_bytes(b"fake-db-content")
    return db


@pytest.fixture
def mock_r2_enabled():
    """Patch R2_ENABLED to True."""
    with patch(f"{MODULE}.R2_ENABLED", True):
        yield


@pytest.fixture
def mock_client():
    """Provide a mock R2 sync client."""
    client = MagicMock()
    with patch(f"{MODULE}.get_r2_sync_client", return_value=client):
        yield client


# ──────────────────────────────────────────────────────
# sync_database_to_r2_with_version
# ──────────────────────────────────────────────────────


class TestSyncDatabaseToR2WithVersion:
    """Tests for the profile database sync function."""

    def test_no_conflict_same_version(self, local_db, mock_r2_enabled, mock_client):
        """R2 version == loaded version → upload succeeds, returns incremented version."""
        with patch(f"{MODULE}.get_db_version_from_r2", return_value=5), \
             patch(f"{RETRY_MODULE}.retry_r2_call") as mock_retry:
            success, new_version = sync_database_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is True
            assert new_version == 6
            mock_retry.assert_called_once()

    def test_no_conflict_r2_older(self, local_db, mock_r2_enabled, mock_client):
        """R2 version < loaded version → upload succeeds."""
        with patch(f"{MODULE}.get_db_version_from_r2", return_value=3), \
             patch(f"{RETRY_MODULE}.retry_r2_call"):
            success, new_version = sync_database_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is True
            assert new_version == 6

    def test_conflict_r2_newer(self, local_db, mock_r2_enabled, mock_client):
        """R2 version > loaded version → conflict, returns (False, r2_version), no upload."""
        with patch(f"{MODULE}.get_db_version_from_r2", return_value=8), \
             patch(f"{RETRY_MODULE}.retry_r2_call") as mock_retry, \
             patch(f"{MODULE}.download_from_r2", return_value=True):
            success, returned_version = sync_database_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is False
            assert returned_version == 8
            # upload should NOT have been called
            mock_retry.assert_not_called()

    def test_conflict_triggers_redownload(self, local_db, mock_r2_enabled, mock_client):
        """On conflict, download_from_r2 is called to re-download newer version."""
        with patch(f"{MODULE}.get_db_version_from_r2", return_value=8), \
             patch(f"{RETRY_MODULE}.retry_r2_call"), \
             patch(f"{MODULE}.download_from_r2", return_value=True) as mock_dl:
            sync_database_to_r2_with_version("user1", local_db, current_version=5)
            mock_dl.assert_called_once_with("user1", "profile.sqlite", local_db)

    def test_r2_disabled(self, local_db):
        """R2 disabled → returns (False, None)."""
        with patch(f"{MODULE}.R2_ENABLED", False):
            success, version = sync_database_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is False
            assert version is None

    def test_no_local_file(self, tmp_path, mock_r2_enabled):
        """Missing local file → returns (False, None)."""
        missing = tmp_path / "nonexistent.sqlite"
        success, version = sync_database_to_r2_with_version(
            "user1", missing, current_version=5
        )
        assert success is False
        assert version is None

    def test_r2_not_found_treated_as_zero(self, local_db, mock_r2_enabled, mock_client):
        """R2VersionResult.NOT_FOUND → treated as version 0, upload succeeds."""
        with patch(f"{MODULE}.get_db_version_from_r2", return_value=R2VersionResult.NOT_FOUND), \
             patch(f"{RETRY_MODULE}.retry_r2_call"):
            success, new_version = sync_database_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is True
            assert new_version == 6

    def test_r2_error_treated_as_zero(self, local_db, mock_r2_enabled, mock_client):
        """R2VersionResult.ERROR → treated as version 0, upload succeeds."""
        with patch(f"{MODULE}.get_db_version_from_r2", return_value=R2VersionResult.ERROR), \
             patch(f"{RETRY_MODULE}.retry_r2_call"):
            success, new_version = sync_database_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is True
            assert new_version == 6

    def test_no_client(self, local_db, mock_r2_enabled):
        """No R2 client available → returns (False, None)."""
        with patch(f"{MODULE}.get_r2_sync_client", return_value=None):
            success, version = sync_database_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is False
            assert version is None

    def test_current_version_none_no_conflict(self, local_db, mock_r2_enabled, mock_client):
        """current_version=None with R2 having a version → no conflict (condition requires not None)."""
        with patch(f"{MODULE}.get_db_version_from_r2", return_value=5), \
             patch(f"{RETRY_MODULE}.retry_r2_call"):
            success, new_version = sync_database_to_r2_with_version(
                "user1", local_db, current_version=None
            )
            assert success is True
            assert new_version == 6


# ──────────────────────────────────────────────────────
# sync_user_db_to_r2_with_version
# ──────────────────────────────────────────────────────


class TestSyncUserDbToR2WithVersion:
    """Tests for the user.sqlite sync function (same conflict pattern)."""

    def test_no_conflict_same_version(self, local_db, mock_r2_enabled, mock_client):
        """R2 version == loaded version → upload succeeds."""
        with patch(f"{MODULE}.get_user_db_version_from_r2", return_value=5), \
             patch(f"{RETRY_MODULE}.retry_r2_call"):
            success, new_version = sync_user_db_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is True
            assert new_version == 6

    def test_no_conflict_r2_older(self, local_db, mock_r2_enabled, mock_client):
        """R2 version < loaded version → upload succeeds."""
        with patch(f"{MODULE}.get_user_db_version_from_r2", return_value=3), \
             patch(f"{RETRY_MODULE}.retry_r2_call"):
            success, new_version = sync_user_db_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is True
            assert new_version == 6

    def test_conflict_r2_newer(self, local_db, mock_r2_enabled, mock_client):
        """R2 version > loaded version → conflict detected, no upload."""
        with patch(f"{MODULE}.get_user_db_version_from_r2", return_value=8), \
             patch(f"{RETRY_MODULE}.retry_r2_call") as mock_retry:
            success, returned_version = sync_user_db_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is False
            assert returned_version == 8
            # The retry_r2_call IS called for re-download, but not for upload
            # Check that any call was for download, not upload
            for call in mock_retry.call_args_list:
                # upload_file should not appear
                assert call[0][0] != mock_client.upload_file

    def test_conflict_triggers_redownload(self, local_db, mock_r2_enabled, mock_client):
        """On conflict, re-download via retry_r2_call with download_file."""
        with patch(f"{MODULE}.get_user_db_version_from_r2", return_value=8), \
             patch(f"{RETRY_MODULE}.retry_r2_call") as mock_retry:
            sync_user_db_to_r2_with_version("user1", local_db, current_version=5)
            # Should have called retry_r2_call with client.download_file
            mock_retry.assert_called_once()
            assert mock_retry.call_args[0][0] == mock_client.download_file

    def test_r2_disabled(self, local_db):
        """R2 disabled → returns (False, None)."""
        with patch(f"{MODULE}.R2_ENABLED", False):
            success, version = sync_user_db_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is False
            assert version is None

    def test_no_local_file(self, tmp_path, mock_r2_enabled):
        """Missing local file → returns (False, None)."""
        missing = tmp_path / "nonexistent.sqlite"
        success, version = sync_user_db_to_r2_with_version(
            "user1", missing, current_version=5
        )
        assert success is False
        assert version is None

    def test_r2_not_found_treated_as_zero(self, local_db, mock_r2_enabled, mock_client):
        """R2VersionResult.NOT_FOUND → version 0, upload succeeds."""
        with patch(f"{MODULE}.get_user_db_version_from_r2", return_value=R2VersionResult.NOT_FOUND), \
             patch(f"{RETRY_MODULE}.retry_r2_call"):
            success, new_version = sync_user_db_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is True
            assert new_version == 6

    def test_no_client(self, local_db, mock_r2_enabled):
        """No R2 client → returns (False, None)."""
        with patch(f"{MODULE}.get_r2_sync_client", return_value=None):
            success, version = sync_user_db_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is False
            assert version is None
