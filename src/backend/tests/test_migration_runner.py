"""
T4830 — Robust migration runner tests (synthetic SQLite fixtures + mocked R2).

Five required scenarios:
  (a) registered profile at OLD user_version → advances to head, upload asserted, R2 verified
  (b) UNREGISTERED (orphan) R2 profile → skipped, in orphans[], never migrated/errored
  (c) download failure → errors[], user NOT reported migrated
  (d) sync failure → errors[], user NOT reported migrated
  (e) verify-in-R2 mismatch → errors[], not_at_head

Plus: from app.main import app must import clean.
"""

import sqlite3
from pathlib import Path
from unittest.mock import MagicMock, patch, call

import pytest

from app.migrations import (
    MigrateResult,
    _migrate_profile_db,
    _migrate_user,
)
from app.migrations.profile_db import RUNNER as PROFILE_DB_RUNNER

USER_ID = "user-t4830-test"
PROFILE_ID = "profile-t4830-abc"
HEAD = PROFILE_DB_RUNNER.latest_version  # 23 (current head)
OLD_VERSION = 1


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_sqlite(path: Path, user_version: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.execute(f"PRAGMA user_version = {user_version}")
    conn.commit()
    conn.close()


def _fake_download_writes_version(version: int):
    """Returns a side_effect for _download_profile_db that writes a SQLite at `version`."""
    def _download(user_id, profile_id, local_path):
        local_path = Path(local_path)
        _make_sqlite(local_path, version)
        return True
    return _download


def _fake_runner_run_advances_to_head(conn, db_type):
    """Side-effect for PROFILE_DB_RUNNER.run: advance DB to HEAD, return fake applied."""
    conn.execute(f"PRAGMA user_version = {HEAD}")
    conn.commit()

    class _FakeMigration:
        version = HEAD
        description = "fake-advance"

    return [_FakeMigration()]


# ---------------------------------------------------------------------------
# (a) Registered profile at OLD version → advances to head, upload asserted, R2 verified
# ---------------------------------------------------------------------------

class TestRegisteredProfileAdvances:
    def test_advances_to_head_and_upload_asserted(self, tmp_path):
        """(a) R2 has profile at OLD_VERSION; after run it reaches HEAD and sync is called."""
        with (
            patch("app.database.USER_DATA_BASE", tmp_path),
            patch("app.storage.get_r2_client", return_value=MagicMock()),
            patch("app.migrations._download_profile_db",
                  side_effect=_fake_download_writes_version(OLD_VERSION)),
            patch.object(PROFILE_DB_RUNNER, "run",
                         side_effect=_fake_runner_run_advances_to_head),
            patch.object(PROFILE_DB_RUNNER, "latest_version", HEAD),
            patch("app.database.sync_db_to_r2_explicit", return_value=True) as mock_sync,
            patch("app.migrations._read_r2_profile_user_version", return_value=HEAD),
        ):
            result = _migrate_profile_db(USER_ID, PROFILE_ID)

        assert result.status == "ok", f"expected ok, got {result.status}"
        assert result.applied, "expected non-empty applied list"
        mock_sync.assert_called_once_with(USER_ID, PROFILE_ID)

    def test_user_reported_migrated_zero_errors(self, tmp_path):
        """(a) user-level: _migrate_user reports migrated, zero errors."""
        with (
            patch("app.database.USER_DATA_BASE", tmp_path),
            patch("app.services.user_db.USER_DATA_BASE", tmp_path),
            patch("app.storage.get_r2_client", return_value=MagicMock()),
            patch("app.migrations._download_profile_db",
                  side_effect=_fake_download_writes_version(OLD_VERSION)),
            patch.object(PROFILE_DB_RUNNER, "run",
                         side_effect=_fake_runner_run_advances_to_head),
            patch.object(PROFILE_DB_RUNNER, "latest_version", HEAD),
            patch("app.database.sync_db_to_r2_explicit", return_value=True),
            patch("app.migrations._read_r2_profile_user_version", return_value=HEAD),
            # user_db helpers
            patch("app.migrations._migrate_user_db", return_value=[]),
            patch("app.services.user_db.get_profiles",
                  return_value=[{"id": PROFILE_ID, "name": "Test", "color": None,
                                 "sport": None, "is_default": 1, "created_at": "2026-01-01"}]),
            patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID]),
        ):
            result = _migrate_user(USER_ID)

        assert result["errors"] == []
        assert result["any_applied"] is True
        assert PROFILE_ID not in result["orphans"]


# ---------------------------------------------------------------------------
# (b) Orphan profile (not in registry) → skipped, in orphans[], never migrated
# ---------------------------------------------------------------------------

class TestOrphanProfile:
    ORPHAN_ID = "orphan-profile-999"

    def test_orphan_skipped_and_reported(self, tmp_path):
        """(b) R2 has orphan; registry has no profiles; orphan in orphans[], zero errors."""
        with (
            patch("app.migrations._migrate_user_db", return_value=[]),
            patch("app.services.user_db.get_profiles", return_value=[]),
            patch("app.migrations._get_profile_ids", return_value=[self.ORPHAN_ID]),
            patch("app.migrations._migrate_profile_db") as mock_migrate,
        ):
            result = _migrate_user(USER_ID)

        mock_migrate.assert_not_called()
        assert self.ORPHAN_ID in result["orphans"]
        assert result["errors"] == []
        assert result["any_applied"] is False

    def test_orphan_never_in_errors(self, tmp_path):
        """(b) Orphan must never appear in errors[]."""
        with (
            patch("app.migrations._migrate_user_db", return_value=[]),
            patch("app.services.user_db.get_profiles", return_value=[]),
            patch("app.migrations._get_profile_ids", return_value=[self.ORPHAN_ID]),
            patch("app.migrations._migrate_profile_db"),
        ):
            result = _migrate_user(USER_ID)

        error_profile_ids = [e.get("profile_id") for e in result["errors"]]
        assert self.ORPHAN_ID not in error_profile_ids


# ---------------------------------------------------------------------------
# (c) Download failure → errors[], user NOT reported migrated
# ---------------------------------------------------------------------------

class TestDownloadFailure:
    def test_download_exception_surfaces_as_download_failed(self, tmp_path):
        """(c) _download_profile_db raises → result.status == 'download_failed'."""
        with (
            patch("app.database.USER_DATA_BASE", tmp_path),
            patch("app.storage.get_r2_client", return_value=MagicMock()),
            patch("app.migrations._download_profile_db",
                  side_effect=Exception("transient R2 network error")),
        ):
            result = _migrate_profile_db(USER_ID, PROFILE_ID)

        assert result.status == "download_failed"
        assert result.applied == []

    def test_download_failure_user_not_migrated(self, tmp_path):
        """(c) Download failure → user has errors[], is NOT reported migrated."""
        with (
            patch("app.database.USER_DATA_BASE", tmp_path),
            patch("app.storage.get_r2_client", return_value=MagicMock()),
            patch("app.migrations._download_profile_db",
                  side_effect=Exception("network timeout")),
            patch("app.migrations._migrate_user_db", return_value=[]),
            patch("app.services.user_db.get_profiles",
                  return_value=[{"id": PROFILE_ID, "name": "Test", "color": None,
                                 "sport": None, "is_default": 1, "created_at": "2026-01-01"}]),
            patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID]),
        ):
            result = _migrate_user(USER_ID)

        assert any(e["profile_id"] == PROFILE_ID for e in result["errors"])
        assert result["any_applied"] is False


# ---------------------------------------------------------------------------
# (d) Sync failure → errors[], user NOT reported migrated
# ---------------------------------------------------------------------------

class TestSyncFailure:
    def test_sync_failure_surfaces_as_sync_failed(self, tmp_path):
        """(d) sync_db_to_r2_explicit returns False → result.status == 'sync_failed'."""
        with (
            patch("app.database.USER_DATA_BASE", tmp_path),
            patch("app.storage.get_r2_client", return_value=MagicMock()),
            patch("app.migrations._download_profile_db",
                  side_effect=_fake_download_writes_version(OLD_VERSION)),
            patch.object(PROFILE_DB_RUNNER, "run",
                         side_effect=_fake_runner_run_advances_to_head),
            patch.object(PROFILE_DB_RUNNER, "latest_version", HEAD),
            patch("app.database.sync_db_to_r2_explicit", return_value=False),
        ):
            result = _migrate_profile_db(USER_ID, PROFILE_ID)

        assert result.status == "sync_failed"
        assert result.applied  # migrations were applied before sync failed

    def test_sync_failure_user_not_migrated(self, tmp_path):
        """(d) Sync failure → user has errors[]; errors presence blocks migrated/skipped count."""
        with (
            patch("app.database.USER_DATA_BASE", tmp_path),
            patch("app.storage.get_r2_client", return_value=MagicMock()),
            patch("app.migrations._download_profile_db",
                  side_effect=_fake_download_writes_version(OLD_VERSION)),
            patch.object(PROFILE_DB_RUNNER, "run",
                         side_effect=_fake_runner_run_advances_to_head),
            patch.object(PROFILE_DB_RUNNER, "latest_version", HEAD),
            patch("app.database.sync_db_to_r2_explicit", return_value=False),
            patch("app.migrations._migrate_user_db", return_value=[]),
            patch("app.services.user_db.get_profiles",
                  return_value=[{"id": PROFILE_ID, "name": "Test", "color": None,
                                 "sport": None, "is_default": 1, "created_at": "2026-01-01"}]),
            patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID]),
        ):
            result = _migrate_user(USER_ID)

        # errors[] must contain the failing profile (prevents user from being counted as migrated)
        assert any(e["profile_id"] == PROFILE_ID and e["reason"] == "sync_failed"
                   for e in result["errors"])
        # errors being non-empty is what blocks run_all_migrations from counting user as migrated
        assert len(result["errors"]) > 0


# ---------------------------------------------------------------------------
# (e) Verify-in-R2 mismatch → errors[], not_at_head
# ---------------------------------------------------------------------------

class TestVerifyMismatch:
    def test_verify_mismatch_surfaces_as_not_at_head(self, tmp_path):
        """(e) R2 re-read returns version < HEAD → result.status == 'not_at_head'."""
        stale_r2_version = OLD_VERSION  # simulates no-op upload: R2 not updated
        with (
            patch("app.database.USER_DATA_BASE", tmp_path),
            patch("app.storage.get_r2_client", return_value=MagicMock()),
            patch("app.migrations._download_profile_db",
                  side_effect=_fake_download_writes_version(OLD_VERSION)),
            patch.object(PROFILE_DB_RUNNER, "run",
                         side_effect=_fake_runner_run_advances_to_head),
            patch.object(PROFILE_DB_RUNNER, "latest_version", HEAD),
            patch("app.database.sync_db_to_r2_explicit", return_value=True),
            # Verification sees stale R2 version (upload silently no-op'd)
            patch("app.migrations._read_r2_profile_user_version",
                  return_value=stale_r2_version),
        ):
            result = _migrate_profile_db(USER_ID, PROFILE_ID)

        assert result.status == "not_at_head"
        assert result.r2_version == stale_r2_version

    def test_verify_mismatch_user_in_errors(self, tmp_path):
        """(e) not_at_head surfaces in errors[] via _migrate_user."""
        with (
            patch("app.database.USER_DATA_BASE", tmp_path),
            patch("app.storage.get_r2_client", return_value=MagicMock()),
            patch("app.migrations._download_profile_db",
                  side_effect=_fake_download_writes_version(OLD_VERSION)),
            patch.object(PROFILE_DB_RUNNER, "run",
                         side_effect=_fake_runner_run_advances_to_head),
            patch.object(PROFILE_DB_RUNNER, "latest_version", HEAD),
            patch("app.database.sync_db_to_r2_explicit", return_value=True),
            patch("app.migrations._read_r2_profile_user_version", return_value=OLD_VERSION),
            patch("app.migrations._migrate_user_db", return_value=[]),
            patch("app.services.user_db.get_profiles",
                  return_value=[{"id": PROFILE_ID, "name": "Test", "color": None,
                                 "sport": None, "is_default": 1, "created_at": "2026-01-01"}]),
            patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID]),
        ):
            result = _migrate_user(USER_ID)

        assert any(e["profile_id"] == PROFILE_ID and e["reason"] == "not_at_head"
                   for e in result["errors"])


# ---------------------------------------------------------------------------
# App import sanity check
# ---------------------------------------------------------------------------

class TestAppImport:
    def test_app_main_imports_clean(self):
        """from app.main import app must import without errors."""
        from app.main import app  # noqa: F401
        assert app is not None
