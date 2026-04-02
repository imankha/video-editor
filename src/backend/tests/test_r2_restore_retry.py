"""
Tests for T910: R2 restore retry — distinguishing NOT_FOUND from transient ERROR.

Covers:
- R2VersionResult enum members
- get_db_version_from_r2: 404 -> NOT_FOUND, 500/exception -> ERROR, success -> int
- get_user_db_version_from_r2: same pattern
- sync_database_from_r2_if_newer: NOT_FOUND -> (False, None, False), ERROR -> (False, None, True)
- sync_user_db_from_r2_if_newer: same pattern
- ensure_database: NOT_FOUND locks version to 0, ERROR sets cooldown (no version lock)
- ensure_user_database: same pattern
- Cooldown prevents retry within 30s, allows retry after 30s
"""

import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError as BotoClientError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_client_error(code: str):
    """Build a real botocore ClientError with the given HTTP status code string."""
    return BotoClientError({"Error": {"Code": code}}, "HeadObject")


def _make_r2_client_mock():
    """Create a MagicMock R2 client with real ClientError on exceptions."""
    client = MagicMock()
    client.exceptions.ClientError = BotoClientError
    return client


# ---------------------------------------------------------------------------
# 1. R2VersionResult enum
# ---------------------------------------------------------------------------

def test_r2_version_result_members():
    from app.storage import R2VersionResult
    assert R2VersionResult.NOT_FOUND is not R2VersionResult.ERROR
    assert R2VersionResult.NOT_FOUND.value == "not_found"
    assert R2VersionResult.ERROR.value == "error"


# ---------------------------------------------------------------------------
# 2-4. get_db_version_from_r2
# ---------------------------------------------------------------------------

class TestGetDbVersionFromR2:
    """Tests for get_db_version_from_r2."""

    @patch("app.storage.get_r2_client")
    def test_404_returns_not_found(self, mock_get_client):
        from app.storage import get_db_version_from_r2, R2VersionResult

        client = _make_r2_client_mock()
        mock_get_client.return_value = client

        err = _make_client_error("404")
        with patch("app.utils.retry.retry_r2_call", side_effect=err):
            result = get_db_version_from_r2("user123", client=client)

        assert result == R2VersionResult.NOT_FOUND

    @patch("app.storage.get_r2_client")
    def test_500_returns_error(self, mock_get_client):
        from app.storage import get_db_version_from_r2, R2VersionResult

        client = _make_r2_client_mock()
        mock_get_client.return_value = client

        err = _make_client_error("500")
        with patch("app.utils.retry.retry_r2_call", side_effect=err):
            result = get_db_version_from_r2("user123", client=client)

        assert result == R2VersionResult.ERROR

    @patch("app.storage.get_r2_client")
    def test_generic_exception_returns_error(self, mock_get_client):
        from app.storage import get_db_version_from_r2, R2VersionResult

        client = _make_r2_client_mock()
        mock_get_client.return_value = client

        with patch("app.utils.retry.retry_r2_call", side_effect=ConnectionError("timeout")):
            result = get_db_version_from_r2("user123", client=client)

        assert result == R2VersionResult.ERROR

    @patch("app.storage.get_r2_client")
    def test_success_returns_version_int(self, mock_get_client):
        from app.storage import get_db_version_from_r2

        client = _make_r2_client_mock()
        mock_get_client.return_value = client

        response = {"Metadata": {"db-version": "42"}}
        with patch("app.utils.retry.retry_r2_call", return_value=response):
            result = get_db_version_from_r2("user123", client=client)

        assert result == 42

    @patch("app.storage.get_r2_client")
    def test_no_version_metadata_returns_zero(self, mock_get_client):
        from app.storage import get_db_version_from_r2

        client = _make_r2_client_mock()
        mock_get_client.return_value = client

        response = {"Metadata": {}}
        with patch("app.utils.retry.retry_r2_call", return_value=response):
            result = get_db_version_from_r2("user123", client=client)

        assert result == 0

    def test_no_client_returns_error(self):
        from app.storage import get_db_version_from_r2, R2VersionResult

        with patch("app.storage.get_r2_client", return_value=None):
            result = get_db_version_from_r2("user123")

        assert result == R2VersionResult.ERROR


# ---------------------------------------------------------------------------
# 5-6. sync_database_from_r2_if_newer
# ---------------------------------------------------------------------------

class TestSyncDatabaseFromR2IfNewer:
    """Tests for sync_database_from_r2_if_newer."""

    @patch("app.storage.R2_ENABLED", True)
    @patch("app.storage.get_db_version_from_r2")
    def test_not_found_returns_false_none_no_error(self, mock_get_version):
        from app.storage import sync_database_from_r2_if_newer, R2VersionResult

        mock_get_version.return_value = R2VersionResult.NOT_FOUND
        was_synced, new_version, was_error = sync_database_from_r2_if_newer(
            "user123", Path("/tmp/test.db"), None
        )

        assert was_synced is False
        assert new_version is None
        assert was_error is False

    @patch("app.storage.R2_ENABLED", True)
    @patch("app.storage.get_db_version_from_r2")
    def test_error_returns_false_none_with_error(self, mock_get_version):
        from app.storage import sync_database_from_r2_if_newer, R2VersionResult

        mock_get_version.return_value = R2VersionResult.ERROR
        was_synced, new_version, was_error = sync_database_from_r2_if_newer(
            "user123", Path("/tmp/test.db"), None
        )

        assert was_synced is False
        assert new_version is None
        assert was_error is True


# ---------------------------------------------------------------------------
# Same for user.sqlite versions
# ---------------------------------------------------------------------------

class TestGetUserDbVersionFromR2:
    """Tests for get_user_db_version_from_r2."""

    @patch("app.storage.get_r2_client")
    def test_404_returns_not_found(self, mock_get_client):
        from app.storage import get_user_db_version_from_r2, R2VersionResult

        client = _make_r2_client_mock()
        mock_get_client.return_value = client

        err = _make_client_error("404")
        with patch("app.utils.retry.retry_r2_call", side_effect=err):
            result = get_user_db_version_from_r2("user123", client=client)

        assert result == R2VersionResult.NOT_FOUND

    @patch("app.storage.get_r2_client")
    def test_500_returns_error(self, mock_get_client):
        from app.storage import get_user_db_version_from_r2, R2VersionResult

        client = _make_r2_client_mock()
        mock_get_client.return_value = client

        err = _make_client_error("500")
        with patch("app.utils.retry.retry_r2_call", side_effect=err):
            result = get_user_db_version_from_r2("user123", client=client)

        assert result == R2VersionResult.ERROR

    @patch("app.storage.get_r2_client")
    def test_success_returns_version_int(self, mock_get_client):
        from app.storage import get_user_db_version_from_r2

        client = _make_r2_client_mock()
        mock_get_client.return_value = client

        response = {"Metadata": {"db-version": "7"}}
        with patch("app.utils.retry.retry_r2_call", return_value=response):
            result = get_user_db_version_from_r2("user123", client=client)

        assert result == 7

    def test_no_client_returns_error(self):
        from app.storage import get_user_db_version_from_r2, R2VersionResult

        with patch("app.storage.get_r2_client", return_value=None):
            result = get_user_db_version_from_r2("user123")

        assert result == R2VersionResult.ERROR


class TestSyncUserDbFromR2IfNewer:
    """Tests for sync_user_db_from_r2_if_newer."""

    @patch("app.storage.R2_ENABLED", True)
    @patch("app.storage.get_user_db_version_from_r2")
    def test_not_found_returns_false_none_no_error(self, mock_get_version):
        from app.storage import sync_user_db_from_r2_if_newer, R2VersionResult

        mock_get_version.return_value = R2VersionResult.NOT_FOUND
        was_synced, new_version, was_error = sync_user_db_from_r2_if_newer(
            "user123", Path("/tmp/test.db"), None
        )

        assert was_synced is False
        assert new_version is None
        assert was_error is False

    @patch("app.storage.R2_ENABLED", True)
    @patch("app.storage.get_user_db_version_from_r2")
    def test_error_returns_false_none_with_error(self, mock_get_version):
        from app.storage import sync_user_db_from_r2_if_newer, R2VersionResult

        mock_get_version.return_value = R2VersionResult.ERROR
        was_synced, new_version, was_error = sync_user_db_from_r2_if_newer(
            "user123", Path("/tmp/test.db"), None
        )

        assert was_synced is False
        assert new_version is None
        assert was_error is True


# ---------------------------------------------------------------------------
# 7-8. ensure_database: NOT_FOUND locks version, ERROR does not
# ---------------------------------------------------------------------------

class TestEnsureDatabaseRestore:
    """Tests for ensure_database R2 restore behavior."""

    def setup_method(self):
        """Clear module-level state before each test."""
        import app.database as db_mod
        db_mod._initialized_users.clear()
        db_mod._r2_restore_cooldowns.clear()

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.get_current_user_id", return_value="user-abc")
    @patch("app.database.get_current_profile_id", return_value="profile-1")
    @patch("app.database.get_database_path")
    @patch("app.database.ensure_directories")
    @patch("app.database.get_local_db_version", return_value=None)
    @patch("app.database.sync_database_from_r2_if_newer")
    @patch("app.database.set_local_db_version")
    def test_not_found_locks_version_to_zero(
        self, mock_set_version, mock_sync, mock_get_version,
        mock_ensure_dirs, mock_get_path, mock_profile, mock_user
    ):
        """When R2 returns NOT_FOUND, version is locked to 0 (genuinely new user)."""
        mock_db_path = MagicMock()
        mock_db_path.exists.return_value = False
        mock_db_path.stat.return_value = MagicMock(st_size=0)
        mock_get_path.return_value = mock_db_path

        # NOT_FOUND: was_synced=False, new_version=None, was_error=False
        mock_sync.return_value = (False, None, False)

        with patch("app.database.sqlite3.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_connect.return_value = mock_conn

            from app.database import ensure_database
            ensure_database()

        # Version should be locked to 0
        mock_set_version.assert_called_once_with("user-abc", "profile-1", 0)

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.get_current_user_id", return_value="user-abc")
    @patch("app.database.get_current_profile_id", return_value="profile-1")
    @patch("app.database.get_database_path")
    @patch("app.database.ensure_directories")
    @patch("app.database.get_local_db_version", return_value=None)
    @patch("app.database.sync_database_from_r2_if_newer")
    @patch("app.database.set_local_db_version")
    def test_error_does_not_lock_version(
        self, mock_set_version, mock_sync, mock_get_version,
        mock_ensure_dirs, mock_get_path, mock_profile, mock_user
    ):
        """When R2 returns ERROR, version is NOT locked -- cooldown is set instead."""
        mock_db_path = MagicMock()
        mock_db_path.exists.return_value = False
        mock_db_path.stat.return_value = MagicMock(st_size=0)
        mock_get_path.return_value = mock_db_path

        # ERROR: was_synced=False, new_version=None, was_error=True
        mock_sync.return_value = (False, None, True)

        with patch("app.database.sqlite3.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_connect.return_value = mock_conn

            from app.database import ensure_database, _r2_restore_cooldowns
            ensure_database()

        # Version should NOT be set
        mock_set_version.assert_not_called()
        # Cooldown should be set
        assert "user-abc:profile-1" in _r2_restore_cooldowns


# ---------------------------------------------------------------------------
# 9. Cooldown prevents retry within 30s
# ---------------------------------------------------------------------------

class TestCooldownBehavior:
    """Tests for R2 restore cooldown in ensure_database."""

    def setup_method(self):
        import app.database as db_mod
        db_mod._initialized_users.clear()
        db_mod._r2_restore_cooldowns.clear()

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.get_current_user_id", return_value="user-cool")
    @patch("app.database.get_current_profile_id", return_value="profile-1")
    @patch("app.database.get_database_path")
    @patch("app.database.ensure_directories")
    @patch("app.database.get_local_db_version", return_value=None)
    @patch("app.database.sync_database_from_r2_if_newer")
    @patch("app.database.set_local_db_version")
    def test_cooldown_prevents_retry_within_30s(
        self, mock_set_version, mock_sync, mock_get_version,
        mock_ensure_dirs, mock_get_path, mock_profile, mock_user
    ):
        """After an ERROR, subsequent calls within 30s skip R2 check entirely."""
        mock_db_path = MagicMock()
        mock_db_path.exists.return_value = False
        mock_db_path.stat.return_value = MagicMock(st_size=0)
        mock_get_path.return_value = mock_db_path
        mock_sync.return_value = (False, None, True)  # ERROR

        with patch("app.database.sqlite3.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_connect.return_value = mock_conn

            from app.database import ensure_database
            # First call: triggers R2 check, gets ERROR, sets cooldown
            ensure_database()
            assert mock_sync.call_count == 1

            # Second call: should skip R2 check (cooldown active)
            ensure_database()
            assert mock_sync.call_count == 1  # Still 1 -- no new call

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.get_current_user_id", return_value="user-cool")
    @patch("app.database.get_current_profile_id", return_value="profile-1")
    @patch("app.database.get_database_path")
    @patch("app.database.ensure_directories")
    @patch("app.database.get_local_db_version", return_value=None)
    @patch("app.database.sync_database_from_r2_if_newer")
    @patch("app.database.set_local_db_version")
    def test_cooldown_expires_after_30s(
        self, mock_set_version, mock_sync, mock_get_version,
        mock_ensure_dirs, mock_get_path, mock_profile, mock_user
    ):
        """After 30s, the cooldown expires and R2 is checked again."""
        import app.database as db_mod

        mock_db_path = MagicMock()
        mock_db_path.exists.return_value = False
        mock_db_path.stat.return_value = MagicMock(st_size=0)
        mock_get_path.return_value = mock_db_path
        mock_sync.return_value = (False, None, True)  # ERROR

        with patch("app.database.sqlite3.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_connect.return_value = mock_conn

            from app.database import ensure_database
            # First call: triggers R2 check
            ensure_database()
            assert mock_sync.call_count == 1

            # Manually expire the cooldown (set timestamp to 31s ago)
            cache_key = "user-cool:profile-1"
            db_mod._r2_restore_cooldowns[cache_key] = time.time() - 31

            # Next call: cooldown expired, should retry
            ensure_database()
            assert mock_sync.call_count == 2


# ---------------------------------------------------------------------------
# 10. ensure_user_database: same NOT_FOUND vs ERROR behavior
#
# ensure_user_database imports R2_ENABLED from ..storage and
# get_local_user_db_version/set_local_user_db_version from ..database
# inside the function body. We must patch at the SOURCE modules.
# ---------------------------------------------------------------------------

class TestEnsureUserDatabaseRestore:
    """Tests for ensure_user_database R2 restore behavior."""

    def setup_method(self):
        from app.services.user_db import _initialized_user_dbs, _r2_user_restore_cooldowns
        _initialized_user_dbs.clear()
        _r2_user_restore_cooldowns.clear()

    @patch("app.storage.R2_ENABLED", True)
    @patch("app.database.get_local_user_db_version", return_value=None)
    @patch("app.storage.sync_user_db_from_r2_if_newer")
    @patch("app.database.set_local_user_db_version")
    @patch("app.services.user_db._migrate_from_auth_db")
    def test_not_found_locks_version_to_zero(
        self, mock_migrate, mock_set_version, mock_sync, mock_get_version
    ):
        """When R2 returns NOT_FOUND for user.sqlite, version is locked to 0."""
        # NOT_FOUND: was_synced=False, new_version=None, was_error=False
        mock_sync.return_value = (False, None, False)

        with patch("app.services.user_db.sqlite3.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_connect.return_value = mock_conn

            from app.services.user_db import ensure_user_database
            ensure_user_database("user-new")

        mock_set_version.assert_called_once_with("user-new", 0)

    @patch("app.storage.R2_ENABLED", True)
    @patch("app.database.get_local_user_db_version", return_value=None)
    @patch("app.storage.sync_user_db_from_r2_if_newer")
    @patch("app.database.set_local_user_db_version")
    @patch("app.services.user_db._migrate_from_auth_db")
    def test_error_does_not_lock_version(
        self, mock_migrate, mock_set_version, mock_sync, mock_get_version
    ):
        """When R2 returns ERROR for user.sqlite, version is NOT locked."""
        mock_sync.return_value = (False, None, True)

        with patch("app.services.user_db.sqlite3.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_connect.return_value = mock_conn

            from app.services.user_db import (
                ensure_user_database,
                _r2_user_restore_cooldowns,
            )
            ensure_user_database("user-flaky")

        mock_set_version.assert_not_called()
        assert "user-flaky" in _r2_user_restore_cooldowns

    @patch("app.storage.R2_ENABLED", True)
    @patch("app.database.get_local_user_db_version", return_value=None)
    @patch("app.storage.sync_user_db_from_r2_if_newer")
    @patch("app.database.set_local_user_db_version")
    @patch("app.services.user_db._migrate_from_auth_db")
    def test_user_db_cooldown_prevents_retry(
        self, mock_migrate, mock_set_version, mock_sync, mock_get_version
    ):
        """After an ERROR on user.sqlite, cooldown prevents immediate retry."""
        mock_sync.return_value = (False, None, True)  # ERROR

        with patch("app.services.user_db.sqlite3.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_connect.return_value = mock_conn

            from app.services.user_db import ensure_user_database, _initialized_user_dbs
            ensure_user_database("user-retry")
            assert mock_sync.call_count == 1

            # Remove from initialized so ensure_user_database re-enters
            _initialized_user_dbs.discard("user-retry")

            # Second call: cooldown active, should skip R2
            ensure_user_database("user-retry")
            assert mock_sync.call_count == 1  # Still 1

    @patch("app.storage.R2_ENABLED", True)
    @patch("app.database.get_local_user_db_version", return_value=None)
    @patch("app.storage.sync_user_db_from_r2_if_newer")
    @patch("app.database.set_local_user_db_version")
    @patch("app.services.user_db._migrate_from_auth_db")
    def test_user_db_cooldown_expires(
        self, mock_migrate, mock_set_version, mock_sync, mock_get_version
    ):
        """After 30s, user.sqlite cooldown expires and R2 is retried."""
        from app.services.user_db import (
            _r2_user_restore_cooldowns,
            _initialized_user_dbs,
        )
        mock_sync.return_value = (False, None, True)  # ERROR

        with patch("app.services.user_db.sqlite3.connect") as mock_connect:
            mock_conn = MagicMock()
            mock_connect.return_value = mock_conn

            from app.services.user_db import ensure_user_database
            ensure_user_database("user-expire")
            assert mock_sync.call_count == 1

            # Expire cooldown
            _r2_user_restore_cooldowns["user-expire"] = time.time() - 31
            _initialized_user_dbs.discard("user-expire")

            ensure_user_database("user-expire")
            assert mock_sync.call_count == 2
