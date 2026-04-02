"""Tests for T415: Smart Guest Merge on Login.

Verifies that _migrate_guest_profile() merges guest games/achievements
into the recovered account's default profile, deduplicating by blake3_hash.
"""

import sqlite3
from pathlib import Path
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

from app.routers.auth import _migrate_guest_profile, _merge_guest_into_profile


def _create_db(db_path: Path) -> None:
    """Create a database with games, game_videos, and achievements tables."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            video_filename TEXT,
            blake3_hash TEXT,
            clip_count INTEGER DEFAULT 0,
            brilliant_count INTEGER DEFAULT 0,
            great_count INTEGER DEFAULT 0,
            good_count INTEGER DEFAULT 0,
            last_accessed_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            upload_status TEXT DEFAULT 'complete',
            duration REAL,
            video_count INTEGER DEFAULT 1,
            total_size INTEGER DEFAULT 0
        );
        CREATE TABLE game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            duration REAL,
            original_filename TEXT,
            video_size INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (game_id) REFERENCES games(id)
        );
        CREATE TABLE achievements (
            key TEXT PRIMARY KEY,
            achieved_at TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.close()


def _insert_game(db_path: Path, name: str, blake3_hash: str, videos: list[tuple] | None = None) -> int:
    """Insert a game and optional game_videos. Returns game ID."""
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
        (name, blake3_hash)
    )
    game_id = cursor.lastrowid
    if videos:
        for seq, vhash, duration in videos:
            cursor.execute(
                "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration, original_filename) "
                "VALUES (?, ?, ?, ?, ?)",
                (game_id, vhash, seq, duration, f"{vhash}.mp4")
            )
    conn.commit()
    conn.close()
    return game_id


def _insert_achievement(db_path: Path, key: str, achieved_at: str = "2026-01-01T00:00:00") -> None:
    conn = sqlite3.connect(str(db_path))
    conn.execute("INSERT INTO achievements (key, achieved_at) VALUES (?, ?)", (key, achieved_at))
    conn.commit()
    conn.close()


def _count_rows(db_path: Path, table: str) -> int:
    conn = sqlite3.connect(str(db_path))
    count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    conn.close()
    return count


def _get_games(db_path: Path) -> list[dict]:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM games").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@pytest.fixture
def migration_env(tmp_path):
    """Set up guest and recovered user with DBs and mocked R2."""
    guest_user_id = f"guest-{uuid4().hex[:8]}"
    recovered_user_id = f"recovered-{uuid4().hex[:8]}"
    guest_profile_id = uuid4().hex[:8]
    target_profile_id = uuid4().hex[:8]

    guest_db_path = tmp_path / guest_user_id / "profiles" / guest_profile_id / "database.sqlite"
    target_db_path = tmp_path / recovered_user_id / "profiles" / target_profile_id / "database.sqlite"

    _create_db(guest_db_path)
    _create_db(target_db_path)

    return {
        "tmp_path": tmp_path,
        "guest_user_id": guest_user_id,
        "recovered_user_id": recovered_user_id,
        "guest_profile_id": guest_profile_id,
        "target_profile_id": target_profile_id,
        "guest_db_path": guest_db_path,
        "target_db_path": target_db_path,
    }


class TestMergeGuestIntoProfile:
    """T415: _merge_guest_into_profile unit tests."""

    def test_new_games_merged(self, migration_env):
        """Guest games not in target → inserted into target."""
        env = migration_env
        _insert_game(env["guest_db_path"], "Game A", "hash_a",
                     videos=[(1, "vid_a", 120.0)])
        _insert_game(env["guest_db_path"], "Game B", "hash_b")

        merged = _merge_guest_into_profile(env["guest_db_path"], env["target_db_path"])

        assert merged == 2
        assert _count_rows(env["target_db_path"], "games") == 2
        assert _count_rows(env["target_db_path"], "game_videos") == 1

    def test_duplicate_game_skipped(self, migration_env):
        """Guest game with same blake3_hash as target → skipped."""
        env = migration_env
        _insert_game(env["target_db_path"], "Existing Game", "hash_dup")
        _insert_game(env["guest_db_path"], "Guest Game", "hash_dup")

        merged = _merge_guest_into_profile(env["guest_db_path"], env["target_db_path"])

        assert merged == 0
        games = _get_games(env["target_db_path"])
        assert len(games) == 1
        assert games[0]["name"] == "Existing Game"  # target's version preserved

    def test_mixed_new_and_duplicate(self, migration_env):
        """Some guest games are new, some are duplicates."""
        env = migration_env
        _insert_game(env["target_db_path"], "Existing", "hash_existing")
        _insert_game(env["guest_db_path"], "Dup", "hash_existing")
        _insert_game(env["guest_db_path"], "New Game", "hash_new",
                     videos=[(1, "vid_new", 60.0)])

        merged = _merge_guest_into_profile(env["guest_db_path"], env["target_db_path"])

        assert merged == 1
        assert _count_rows(env["target_db_path"], "games") == 2
        assert _count_rows(env["target_db_path"], "game_videos") == 1

    def test_achievements_merged(self, migration_env):
        """Guest achievements inserted, target's kept on conflict."""
        env = migration_env
        _insert_achievement(env["target_db_path"], "first_clip", "2026-01-01")
        _insert_achievement(env["guest_db_path"], "first_clip", "2026-02-01")  # conflict
        _insert_achievement(env["guest_db_path"], "first_upload", "2026-02-15")  # new

        _merge_guest_into_profile(env["guest_db_path"], env["target_db_path"])

        conn = sqlite3.connect(str(env["target_db_path"]))
        conn.row_factory = sqlite3.Row
        achievements = {r['key']: r['achieved_at'] for r in conn.execute("SELECT * FROM achievements").fetchall()}
        conn.close()

        assert len(achievements) == 2
        assert achievements["first_clip"] == "2026-01-01"  # target's kept
        assert achievements["first_upload"] == "2026-02-15"  # guest's added

    def test_game_videos_remapped(self, migration_env):
        """game_videos get correct game_id after merge."""
        env = migration_env
        _insert_game(env["guest_db_path"], "Game X", "hash_x",
                     videos=[(1, "vid_x1", 60.0), (2, "vid_x2", 90.0)])

        _merge_guest_into_profile(env["guest_db_path"], env["target_db_path"])

        conn = sqlite3.connect(str(env["target_db_path"]))
        conn.row_factory = sqlite3.Row
        game = conn.execute("SELECT id FROM games WHERE blake3_hash = 'hash_x'").fetchone()
        videos = conn.execute("SELECT * FROM game_videos WHERE game_id = ?", (game['id'],)).fetchall()
        conn.close()

        assert len(videos) == 2
        seqs = sorted(v['sequence'] for v in videos)
        assert seqs == [1, 2]

    def test_empty_guest_returns_zero(self, migration_env):
        """Guest with no games → merged count is 0, target unchanged."""
        env = migration_env
        _insert_game(env["target_db_path"], "Existing", "hash_e")

        merged = _merge_guest_into_profile(env["guest_db_path"], env["target_db_path"])

        assert merged == 0
        assert _count_rows(env["target_db_path"], "games") == 1


class TestMigrateGuestProfile:
    """T415: Full _migrate_guest_profile integration tests."""

    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.read_selected_profile_from_r2")
    @patch("app.routers.auth.get_current_profile_id", return_value="current-ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_guest_with_games_merges_into_default(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload,
        migration_env
    ):
        """Guest with games → merged into recovered account's default profile, no new profile created."""
        env = migration_env
        _insert_game(env["guest_db_path"], "Guest Game", "hash_g",
                     videos=[(1, "vid_g", 120.0)])

        # read_selected_profile_from_r2 called twice: once for guest, once for recovered
        mock_read_selected.side_effect = [env["guest_profile_id"], env["target_profile_id"]]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        # Game merged into target DB
        assert _count_rows(env["target_db_path"], "games") == 1
        assert _count_rows(env["target_db_path"], "game_videos") == 1

        # R2 upload called with target profile
        mock_upload.assert_called_once()
        mock_set_profile.assert_any_call(env["target_profile_id"])
        # Profile context restored
        mock_set_profile.assert_any_call("current-ctx")

    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.read_selected_profile_from_r2")
    @patch("app.routers.auth.get_current_profile_id", return_value="current-ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_no_extra_profile_created(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload,
        migration_env
    ):
        """No 'Guest N' profile is ever created — merge only."""
        env = migration_env
        _insert_game(env["guest_db_path"], "Game", "hash_1")
        mock_read_selected.side_effect = [env["guest_profile_id"], env["target_profile_id"]]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        # No save_profiles_json call (no new profile added)
        # Check that no new profile directories were created
        recovered_profiles_dir = env["tmp_path"] / env["recovered_user_id"] / "profiles"
        profile_dirs = list(recovered_profiles_dir.iterdir())
        assert len(profile_dirs) == 1  # only the target profile, no new ones
        assert profile_dirs[0].name == env["target_profile_id"]

    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.read_selected_profile_from_r2")
    @patch("app.routers.auth.get_current_profile_id", return_value="current-ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_guest_without_games_skips(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload,
        migration_env
    ):
        """Guest without games → no merge, no R2 upload."""
        env = migration_env
        mock_read_selected.return_value = env["guest_profile_id"]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        mock_upload.assert_not_called()

    @patch("app.routers.auth.read_selected_profile_from_r2", return_value=None)
    def test_no_guest_profile_skips(self, mock_read_selected, migration_env):
        """Guest with no profile in R2 → skip."""
        env = migration_env
        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])
        mock_read_selected.assert_called_once_with(env["guest_user_id"])

    def test_same_user_skips(self, migration_env):
        """Same user_id for guest and recovered → skip (re-login)."""
        env = migration_env
        _migrate_guest_profile(env["guest_user_id"], env["guest_user_id"])

    @patch("app.routers.auth.read_selected_profile_from_r2")
    def test_r2_error_raises(self, mock_read_selected, migration_env):
        """T820: R2ReadError during profile lookup → raises (caller blocks login)."""
        from app.storage import R2ReadError
        env = migration_env
        mock_read_selected.side_effect = R2ReadError("connection timeout")
        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            with pytest.raises(R2ReadError):
                _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

    @patch("app.routers.auth.read_selected_profile_from_r2")
    def test_no_local_db_skips(self, mock_read_selected, migration_env):
        """Guest profile exists in R2 but no local DB → skip."""
        env = migration_env
        mock_read_selected.return_value = "nonexistent-profile"
        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

    @patch("app.routers.auth.upload_to_r2", return_value=True)
    @patch("app.routers.auth.read_selected_profile_from_r2")
    @patch("app.routers.auth.get_current_profile_id", return_value="current-ctx")
    @patch("app.routers.auth.set_current_profile_id")
    def test_dedup_preserves_target_game(
        self, mock_set_profile, mock_get_profile,
        mock_read_selected, mock_upload,
        migration_env
    ):
        """Same blake3_hash in both → target's game row preserved, no duplicate."""
        env = migration_env
        _insert_game(env["target_db_path"], "Target Version", "hash_shared")
        _insert_game(env["guest_db_path"], "Guest Version", "hash_shared")
        mock_read_selected.side_effect = [env["guest_profile_id"], env["target_profile_id"]]

        with patch("app.routers.auth.USER_DATA_BASE", env["tmp_path"]):
            _migrate_guest_profile(env["guest_user_id"], env["recovered_user_id"])

        games = _get_games(env["target_db_path"])
        assert len(games) == 1
        assert games[0]["name"] == "Target Version"
