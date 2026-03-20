"""Tests for T410: Migrate Guest Progress on Login.

Verifies that _migrate_guest_profile() correctly copies a guest's profile
to the recovered account when the guest has games, and skips migration
when the guest has no games or no profile.
"""

import sqlite3
import json
from pathlib import Path
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

from app.routers.auth import _migrate_guest_profile


@pytest.fixture
def migration_env(tmp_path):
    """Set up guest and recovered user with local DB and mocked R2."""
    guest_user_id = f"guest-{uuid4().hex[:8]}"
    recovered_user_id = f"recovered-{uuid4().hex[:8]}"
    guest_profile_id = uuid4().hex[:8]
    original_profile_id = "original01"

    # Create guest DB with games table
    guest_db_dir = tmp_path / guest_user_id / "profiles" / guest_profile_id
    guest_db_dir.mkdir(parents=True)
    guest_db_path = guest_db_dir / "database.sqlite"

    conn = sqlite3.connect(str(guest_db_path))
    conn.execute("""CREATE TABLE games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    )""")
    conn.commit()
    conn.close()

    # Recovered user's existing profiles.json
    recovered_profiles = {
        "default": original_profile_id,
        "profiles": {
            original_profile_id: {"name": None, "color": "#FF5733"}
        }
    }

    return {
        "tmp_path": tmp_path,
        "guest_user_id": guest_user_id,
        "recovered_user_id": recovered_user_id,
        "guest_profile_id": guest_profile_id,
        "original_profile_id": original_profile_id,
        "guest_db_path": guest_db_path,
        "recovered_profiles": recovered_profiles,
    }


def _add_games_to_db(db_path: Path, count: int):
    """Insert N games into a guest database."""
    conn = sqlite3.connect(str(db_path))
    for i in range(count):
        conn.execute("INSERT INTO games (name) VALUES (?)", (f"Game {i+1}",))
    conn.commit()
    conn.close()


class TestGuestMigration:
    """T410: _migrate_guest_profile tests."""

    @patch("app.routers.auth.save_profiles_json", return_value=True)
    @patch("app.routers.auth.read_profiles_json")
    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.read_selected_profile_from_r2")
    @patch("app.routers.auth.get_current_profile_id", return_value="current-ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_guest_with_games_creates_second_profile(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload, mock_read_profiles, mock_save_profiles,
        migration_env
    ):
        """Guest with games → migrated profile named 'second' on recovered account."""
        env = migration_env
        _add_games_to_db(env["guest_db_path"], 2)

        mock_read_selected.return_value = env["guest_profile_id"]
        mock_read_profiles.return_value = env["recovered_profiles"].copy()

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        # Verify profiles.json was updated with "second" profile
        saved_data = mock_save_profiles.call_args[0][1]
        new_profiles = {
            pid: meta for pid, meta in saved_data["profiles"].items()
            if pid != env["original_profile_id"]
        }
        assert len(new_profiles) == 1
        new_pid, new_meta = list(new_profiles.items())[0]
        assert new_meta["name"] == "second"
        assert new_meta["color"] == "#4A90D9"

        # Verify local DB was copied
        dest_db = env["tmp_path"] / env["recovered_user_id"] / "profiles" / new_pid / "database.sqlite"
        assert dest_db.exists()

        # Verify copied DB has the games
        conn = sqlite3.connect(str(dest_db))
        count = conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]
        conn.close()
        assert count == 2

        # Verify R2 upload was called
        mock_upload.assert_called_once()

        # Verify profile context was restored
        mock_set_profile.assert_any_call("current-ctx")

    @patch("app.routers.auth.save_profiles_json", return_value=True)
    @patch("app.routers.auth.read_profiles_json")
    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.read_selected_profile_from_r2")
    @patch("app.routers.auth.get_current_profile_id", return_value="current-ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_guest_without_games_skips_migration(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload, mock_read_profiles, mock_save_profiles,
        migration_env
    ):
        """Guest without games → no profile created on recovered account."""
        env = migration_env
        # Don't add any games

        mock_read_selected.return_value = env["guest_profile_id"]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        # No profile should have been created
        mock_save_profiles.assert_not_called()
        mock_upload.assert_not_called()

        # No local directory created for recovered user
        recovered_profiles_dir = env["tmp_path"] / env["recovered_user_id"] / "profiles"
        assert not recovered_profiles_dir.exists()

    @patch("app.routers.auth.read_selected_profile_from_r2", return_value=None)
    def test_no_guest_profile_skips_migration(self, mock_read_selected, migration_env):
        """Guest with no profile in R2 → skip migration."""
        env = migration_env

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        # Nothing should happen — no crash
        mock_read_selected.assert_called_once_with(env["guest_user_id"])

    @patch("app.routers.auth.save_profiles_json", return_value=True)
    @patch("app.routers.auth.read_profiles_json")
    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.read_selected_profile_from_r2")
    @patch("app.routers.auth.get_current_profile_id", return_value="current-ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_original_profile_unchanged(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload, mock_read_profiles, mock_save_profiles,
        migration_env
    ):
        """Original/default profile remains unchanged after migration."""
        env = migration_env
        _add_games_to_db(env["guest_db_path"], 1)

        mock_read_selected.return_value = env["guest_profile_id"]
        mock_read_profiles.return_value = env["recovered_profiles"].copy()

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        # Original profile must still be there, unchanged
        saved_data = mock_save_profiles.call_args[0][1]
        assert env["original_profile_id"] in saved_data["profiles"]
        assert saved_data["profiles"][env["original_profile_id"]]["name"] is None
        assert saved_data["default"] == env["original_profile_id"]

    def test_same_user_skips_migration(self, migration_env):
        """Same user_id for guest and recovered → skip (re-login, not cross-device)."""
        env = migration_env
        # Should return immediately, no R2 calls
        _migrate_guest_profile(env["guest_user_id"], env["guest_user_id"])

    @patch("app.routers.auth.read_selected_profile_from_r2")
    def test_r2_error_skips_migration(self, mock_read_selected, migration_env):
        """R2ReadError during profile lookup → skip migration, don't crash."""
        from app.storage import R2ReadError
        env = migration_env
        mock_read_selected.side_effect = R2ReadError("connection timeout")

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            # Should not raise
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

    @patch("app.routers.auth.read_selected_profile_from_r2")
    def test_no_local_db_skips_migration(self, mock_read_selected, migration_env):
        """Guest profile exists in R2 but no local DB file → skip migration."""
        env = migration_env
        mock_read_selected.return_value = "nonexistent-profile"

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        # No crash, no files created
        recovered_profiles_dir = env["tmp_path"] / env["recovered_user_id"] / "profiles"
        assert not recovered_profiles_dir.exists()
