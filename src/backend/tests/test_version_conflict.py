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

    def test_conflict_refuses_without_redownload(self, local_db, mock_r2_enabled, mock_client):
        """T4310 round 2 (MAJOR-2): on conflict, storage.py refuses the upload
        but does NOT re-download R2's copy over the local file -- that swap
        used to run here but went LIVE (and WAL-unsafe) once T4310 turned CAS
        on for the normal write path: profile.sqlite is WAL-mode and
        _background_sync runs outside the per-user write lock, so replacing
        the main DB file while a stale -wal sits beside it risks cross-DB page
        mixing. Refusing alone is safe -- the caller freezes the baseline
        instead of adopting R2's version, so the same conflict is refused
        again on every retry until T4315's restore path heals it."""
        with patch(f"{MODULE}.get_db_version_from_r2", return_value=8), \
             patch(f"{RETRY_MODULE}.retry_r2_call") as mock_retry, \
             patch(f"{MODULE}.download_from_r2") as mock_dl:
            success, returned_version = sync_database_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is False
            assert returned_version == 8
            mock_dl.assert_not_called()
            mock_retry.assert_not_called()
            # The local file itself must be untouched -- no WAL-unsafe swap.
            assert local_db.read_bytes() == b"fake-db-content"

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

    def test_current_version_none_refuses_when_r2_has_real_content(
        self, local_db, mock_r2_enabled, mock_client
    ):
        """T4315 round 2 (BLOCKING-2): current_version=None means this writer never
        confirmed a baseline (e.g. a fresh-machine restore errored and an empty
        schema'd DB got created anyway). Uploading blindly here force-pushes an
        empty/stale local DB over the user's real R2 data with zero conflict
        signal -- the catastrophic variant this task exists to prevent. An
        unconfirmed baseline against real R2 content (r2_version > 0) must now
        refuse exactly like a stale-but-known one."""
        with patch(f"{MODULE}.get_db_version_from_r2", return_value=5), \
             patch(f"{RETRY_MODULE}.retry_r2_call"):
            success, new_version = sync_database_to_r2_with_version(
                "user1", local_db, current_version=None
            )
            assert success is False
            assert new_version == 5

    def test_current_version_none_still_uploads_when_r2_genuinely_empty(
        self, local_db, mock_r2_enabled, mock_client
    ):
        """No regression for a genuinely brand-new user: current_version=None
        with R2 NOT_FOUND (no object at all -- treated as version 0) is not an
        "unconfirmed baseline against real content" situation, so the upload
        must still proceed normally."""
        with patch(f"{MODULE}.get_db_version_from_r2", return_value=R2VersionResult.NOT_FOUND), \
             patch(f"{RETRY_MODULE}.retry_r2_call"):
            success, new_version = sync_database_to_r2_with_version(
                "user1", local_db, current_version=None
            )
            assert success is True
            assert new_version == 1


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

    def test_conflict_refuses_without_redownload(self, local_db, mock_r2_enabled, mock_client):
        """T4310 round 2 (MAJOR-2): on conflict, no re-download -- see the
        profile-DB twin above for the WAL-corruption rationale. retry_r2_call
        must not be invoked at all (the old code used it for the
        download_file re-fetch); the local file is left untouched."""
        with patch(f"{MODULE}.get_user_db_version_from_r2", return_value=8), \
             patch(f"{RETRY_MODULE}.retry_r2_call") as mock_retry:
            success, returned_version = sync_user_db_to_r2_with_version(
                "user1", local_db, current_version=5
            )
            assert success is False
            assert returned_version == 8
            mock_retry.assert_not_called()
            assert local_db.read_bytes() == b"fake-db-content"

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

    def test_current_version_none_refuses_when_r2_has_real_content(
        self, local_db, mock_r2_enabled, mock_client
    ):
        """T4315 round 2 (BLOCKING-2): an unconfirmed baseline (current_version
        is None -- e.g. a fresh-machine restore errored and ensure_user_database
        created an empty schema'd user.sqlite anyway) must refuse to upload over
        REAL R2 content (credits/profiles/quests), never silently force-push an
        empty DB over a user's account with zero conflict signal."""
        with patch(f"{MODULE}.get_user_db_version_from_r2", return_value=5), \
             patch(f"{RETRY_MODULE}.retry_r2_call"):
            success, new_version = sync_user_db_to_r2_with_version(
                "user1", local_db, current_version=None
            )
            assert success is False
            assert new_version == 5

    def test_current_version_none_still_uploads_when_r2_genuinely_empty(
        self, local_db, mock_r2_enabled, mock_client
    ):
        """No regression for a genuinely brand-new user: NOT_FOUND (no R2
        object at all) is not "unconfirmed against real content", so the
        upload must still proceed."""
        with patch(f"{MODULE}.get_user_db_version_from_r2", return_value=R2VersionResult.NOT_FOUND), \
             patch(f"{RETRY_MODULE}.retry_r2_call"):
            success, new_version = sync_user_db_to_r2_with_version(
                "user1", local_db, current_version=None
            )
            assert success is True
            assert new_version == 1
