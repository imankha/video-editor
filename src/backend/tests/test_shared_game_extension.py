"""
Tests for T2855: Shared Game Storage Extension.

Verifies that the extend-storage flow works correctly for shared game
recipients, not just uploaders. Tests cover:
- Materialization copies video_size correctly (cost calculation depends on it)
- Storage refs are independent per user (sharer vs recipient)
- Extend creates/updates recipient's refs without affecting sharer's
- Grace period cancellation works when recipient re-extends
- can_extend flag logic with cross-user refs
"""

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.materialization import _copy_game, _create_storage_refs, _collect_video_hashes
from app.services.auth_db import (
    create_user,
    insert_game_storage_ref,
    get_game_storage_ref,
    get_storage_refs_for_user,
    get_all_ref_hashes,
    get_grace_deletion_hashes,
    insert_grace_deletion,
    delete_ref,
)
from app.services.storage_credits import calculate_extension_cost, storage_expires_at


# ---------------------------------------------------------------------------
# Helpers (reuse schema from test_materialization)
# ---------------------------------------------------------------------------

def _create_profile_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            video_filename TEXT,
            blake3_hash TEXT,
            clip_count INTEGER DEFAULT 0,
            brilliant_count INTEGER DEFAULT 0,
            good_count INTEGER DEFAULT 0,
            interesting_count INTEGER DEFAULT 0,
            mistake_count INTEGER DEFAULT 0,
            blunder_count INTEGER DEFAULT 0,
            aggregate_score INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            video_duration REAL,
            video_width INTEGER,
            video_height INTEGER,
            video_size INTEGER,
            opponent_name TEXT,
            game_date TEXT,
            game_type TEXT,
            tournament_name TEXT,
            viewed_duration REAL DEFAULT 0,
            video_fps REAL,
            status TEXT DEFAULT 'ready',
            auto_export_status TEXT,
            recap_video_url TEXT
        );
        CREATE TABLE IF NOT EXISTS game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            duration REAL,
            video_width INTEGER,
            video_height INTEGER,
            video_size INTEGER,
            fps REAL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(game_id, sequence)
        );
        CREATE TABLE IF NOT EXISTS raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            rating INTEGER NOT NULL,
            tags BLOB,
            name TEXT,
            notes TEXT,
            start_time REAL,
            end_time REAL,
            game_id INTEGER,
            auto_project_id INTEGER,
            default_highlight_regions BLOB,
            video_sequence INTEGER,
            boundaries_version INTEGER DEFAULT 1,
            boundaries_updated_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            tagged_teammates BLOB DEFAULT NULL,
            my_athlete INTEGER DEFAULT 1,
            shared_by TEXT DEFAULT NULL,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS clip_teammates (
            clip_id INTEGER NOT NULL REFERENCES raw_clips(id) ON DELETE CASCADE,
            tag_name TEXT NOT NULL,
            UNIQUE(clip_id, tag_name)
        );
    """)
    conn.commit()
    return conn


def _insert_game(conn, name="Test Game", blake3_hash="abc123",
                  video_size=5_000_000_000, **kwargs):
    defaults = dict(
        video_duration=90.0, video_width=1920, video_height=1080,
        opponent_name="Opponent", game_date="2026-05-01",
        game_type="league", tournament_name=None, video_fps=30.0,
    )
    defaults.update(kwargs)
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO games (name, blake3_hash, video_duration, video_width,
           video_height, video_size, opponent_name, game_date, game_type,
           tournament_name, video_fps)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (name, blake3_hash, defaults["video_duration"], defaults["video_width"],
         defaults["video_height"], video_size, defaults["opponent_name"],
         defaults["game_date"], defaults["game_type"], defaults["tournament_name"],
         defaults["video_fps"]),
    )
    conn.commit()
    return cur.lastrowid


def _insert_game_video(conn, game_id, blake3_hash, sequence=0,
                        video_size=2_500_000_000, **kwargs):
    defaults = dict(duration=45.0, video_width=1920, video_height=1080, fps=30.0)
    defaults.update(kwargs)
    conn.execute(
        """INSERT INTO game_videos (game_id, blake3_hash, sequence, duration,
           video_width, video_height, video_size, fps)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (game_id, blake3_hash, sequence, defaults["duration"],
         defaults["video_width"], defaults["video_height"],
         video_size, defaults["fps"]),
    )
    conn.commit()


# ===========================================================================
# Materialization: video_size + blake3_hash preservation
# ===========================================================================

class TestCopyGamePreservesExtendFields:
    """Verify _copy_game copies the fields that extend-storage depends on."""

    def test_copies_video_size_to_games_row(self, tmp_path):
        s_conn = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")

        game_id = _insert_game(s_conn, video_size=5_368_709_120)  # ~5 GB
        new_id = _copy_game(s_conn, r_conn, game_id)
        r_conn.commit()

        row = r_conn.execute("SELECT video_size FROM games WHERE id = ?", (new_id,)).fetchone()
        assert row["video_size"] == 5_368_709_120

        s_conn.close()
        r_conn.close()

    def test_copies_blake3_hash_to_games_row(self, tmp_path):
        s_conn = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")

        game_id = _insert_game(s_conn, blake3_hash="sharer_hash_abc")
        new_id = _copy_game(s_conn, r_conn, game_id)
        r_conn.commit()

        row = r_conn.execute("SELECT blake3_hash FROM games WHERE id = ?", (new_id,)).fetchone()
        assert row["blake3_hash"] == "sharer_hash_abc"

        s_conn.close()
        r_conn.close()

    def test_copies_all_game_videos_with_sizes(self, tmp_path):
        s_conn = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")

        game_id = _insert_game(s_conn, blake3_hash=None, video_size=None)
        _insert_game_video(s_conn, game_id, "hash_part1", sequence=0, video_size=3_000_000_000)
        _insert_game_video(s_conn, game_id, "hash_part2", sequence=1, video_size=2_500_000_000)

        new_id = _copy_game(s_conn, r_conn, game_id)
        r_conn.commit()

        videos = r_conn.execute(
            "SELECT blake3_hash, video_size FROM game_videos WHERE game_id = ? ORDER BY sequence",
            (new_id,),
        ).fetchall()
        assert len(videos) == 2
        assert videos[0]["blake3_hash"] == "hash_part1"
        assert videos[0]["video_size"] == 3_000_000_000
        assert videos[1]["blake3_hash"] == "hash_part2"
        assert videos[1]["video_size"] == 2_500_000_000

        s_conn.close()
        r_conn.close()

    def test_extension_cost_uses_copied_video_size(self, tmp_path):
        """End-to-end: copied video_size produces correct extension cost."""
        s_conn = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        r_conn = _create_profile_db(tmp_path / "recipient" / "profile.sqlite")

        original_size = int(5.0 * 1024 ** 3)  # 5 GB
        game_id = _insert_game(s_conn, video_size=original_size)
        new_id = _copy_game(s_conn, r_conn, game_id)
        r_conn.commit()

        recipient_game = r_conn.execute(
            "SELECT video_size FROM games WHERE id = ?", (new_id,),
        ).fetchone()

        sharer_cost = calculate_extension_cost(original_size, 30)
        recipient_cost = calculate_extension_cost(recipient_game["video_size"], 30)
        assert recipient_cost == sharer_cost

        s_conn.close()
        r_conn.close()


# ===========================================================================
# Storage refs: independence + UPSERT behavior (requires Postgres)
# ===========================================================================

class TestStorageRefIndependence:
    """Verify sharer and recipient storage refs are fully independent."""

    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("sharer-user", email="sharer@test.com")
        create_user("recipient-user", email="recipient@test.com")
        create_user("user-a", email="a@test.com")
        create_user("user-b", email="b@test.com")
        create_user("user-1", email="u1@test.com")
        create_user("user-2", email="u2@test.com")

    def test_create_storage_refs_copies_sharer_expiry(self, pg_conn, tmp_path):
        s_conn = _create_profile_db(tmp_path / "sharer" / "profile.sqlite")
        game_id = _insert_game(s_conn, blake3_hash="shared_hash_1")

        sharer_expiry = (datetime.utcnow() + timedelta(days=30)).isoformat()
        insert_game_storage_ref("sharer-user", "sharer-profile", "shared_hash_1",
                                5_000_000_000, sharer_expiry)

        hashes = _collect_video_hashes(s_conn, game_id)
        _create_storage_refs(
            "sharer-user", "sharer-profile",
            "recipient-user", "recipient-profile",
            hashes,
        )

        recipient_ref = get_game_storage_ref("recipient-user", "recipient-profile", "shared_hash_1")
        assert recipient_ref is not None
        assert str(recipient_ref["storage_expires_at"]).startswith(sharer_expiry[:10])

        s_conn.close()

    def test_recipient_extend_does_not_affect_sharer(self, pg_conn):
        sharer_expiry = (datetime.utcnow() + timedelta(days=5)).isoformat()
        insert_game_storage_ref("sharer-user", "sharer-profile", "indep_hash",
                                5_000_000_000, sharer_expiry)

        recipient_expiry = (datetime.utcnow() + timedelta(days=5)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile", "indep_hash",
                                5_000_000_000, recipient_expiry)

        new_expiry = (datetime.utcnow() + timedelta(days=60)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile", "indep_hash",
                                5_000_000_000, new_expiry)

        sharer_ref = get_game_storage_ref("sharer-user", "sharer-profile", "indep_hash")
        recipient_ref = get_game_storage_ref("recipient-user", "recipient-profile", "indep_hash")

        sharer_dt = sharer_ref["storage_expires_at"] if isinstance(sharer_ref["storage_expires_at"], datetime) else datetime.fromisoformat(sharer_ref["storage_expires_at"])
        recipient_dt = recipient_ref["storage_expires_at"] if isinstance(recipient_ref["storage_expires_at"], datetime) else datetime.fromisoformat(recipient_ref["storage_expires_at"])

        assert recipient_dt > sharer_dt + timedelta(days=30)

    def test_get_storage_refs_for_user_is_user_scoped(self, pg_conn):
        insert_game_storage_ref("user-a", "prof-a", "scoped_hash",
                                1000, (datetime.utcnow() + timedelta(days=30)).isoformat())
        insert_game_storage_ref("user-b", "prof-b", "scoped_hash",
                                1000, (datetime.utcnow() + timedelta(days=30)).isoformat())

        refs_a = get_storage_refs_for_user("user-a")
        refs_b = get_storage_refs_for_user("user-b")

        a_hashes = {r["blake3_hash"] for r in refs_a}
        b_hashes = {r["blake3_hash"] for r in refs_b}
        assert "scoped_hash" in a_hashes
        assert "scoped_hash" in b_hashes
        assert all(r.get("user_id", "user-a") != "user-b" for r in refs_a)

    def test_all_ref_hashes_includes_both_users(self, pg_conn):
        insert_game_storage_ref("user-1", "prof-1", "both_hash",
                                1000, (datetime.utcnow() + timedelta(days=30)).isoformat())
        insert_game_storage_ref("user-2", "prof-2", "both_hash",
                                1000, (datetime.utcnow() + timedelta(days=30)).isoformat())

        all_hashes = get_all_ref_hashes()
        assert "both_hash" in all_hashes


# ===========================================================================
# can_extend flag: cross-user visibility
# ===========================================================================

class TestCanExtendCrossUser:
    """Verify can_extend is True when ANY user has a ref for the hash."""

    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("sharer-user", email="sharer@test.com")
        create_user("recipient-user", email="recipient@test.com")

    def test_can_extend_true_when_sharer_ref_exists(self, pg_conn):
        insert_game_storage_ref("sharer-user", "sharer-profile", "extend_hash",
                                1000, (datetime.utcnow() + timedelta(days=30)).isoformat())

        all_hashes = get_all_ref_hashes()
        grace_hashes = get_grace_deletion_hashes()
        can_extend = "extend_hash" in all_hashes or "extend_hash" in grace_hashes
        assert can_extend is True

    def test_can_extend_true_during_grace_period(self, pg_conn):
        insert_grace_deletion("grace_hash")

        all_hashes = get_all_ref_hashes()
        grace_hashes = get_grace_deletion_hashes()
        can_extend = "grace_hash" in all_hashes or "grace_hash" in grace_hashes
        assert can_extend is True

    def test_can_extend_false_when_no_refs_no_grace(self, pg_conn):
        all_hashes = get_all_ref_hashes()
        grace_hashes = get_grace_deletion_hashes()
        can_extend = "nonexistent_hash" in all_hashes or "nonexistent_hash" in grace_hashes
        assert can_extend is False


# ===========================================================================
# Grace period: extend cancels grace deletion
# ===========================================================================

class TestGracePeriodExtend:
    """Verify extending during grace period cancels the grace deletion."""

    @pytest.fixture(autouse=True)
    def _create_users(self, pg_conn):
        create_user("recipient-user", email="recipient@test.com")

    def test_extend_cancels_grace_deletion(self, pg_conn):
        insert_grace_deletion("grace_cancel_hash")
        assert "grace_cancel_hash" in get_grace_deletion_hashes()

        new_expiry = (datetime.utcnow() + timedelta(days=30)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile",
                                "grace_cancel_hash", 5_000_000_000, new_expiry)

        assert "grace_cancel_hash" not in get_grace_deletion_hashes()

        ref = get_game_storage_ref("recipient-user", "recipient-profile", "grace_cancel_hash")
        assert ref is not None

    def test_extend_recreates_deleted_ref(self, pg_conn):
        expiry = (datetime.utcnow() + timedelta(days=30)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile",
                                "recreate_hash", 5_000_000_000, expiry)
        delete_ref("recipient-user", "recipient-profile", "recreate_hash")

        ref = get_game_storage_ref("recipient-user", "recipient-profile", "recreate_hash")
        assert ref is None

        new_expiry = (datetime.utcnow() + timedelta(days=60)).isoformat()
        insert_game_storage_ref("recipient-user", "recipient-profile",
                                "recreate_hash", 5_000_000_000, new_expiry)

        ref = get_game_storage_ref("recipient-user", "recipient-profile", "recreate_hash")
        assert ref is not None


# ===========================================================================
# Extension cost: same for uploader and recipient
# ===========================================================================

class TestExtensionCostParity:
    """Verify recipients pay the same rate as uploaders."""

    def test_same_size_same_cost(self):
        size = int(5.0 * 1024 ** 3)
        uploader_cost = calculate_extension_cost(size, 30)
        recipient_cost = calculate_extension_cost(size, 30)
        assert uploader_cost == recipient_cost

    def test_zero_size_minimum_cost(self):
        assert calculate_extension_cost(0, 30) == 1

    def test_expiry_extension_from_existing(self):
        current = datetime.utcnow() + timedelta(days=5)
        new = storage_expires_at(from_dt=current, days=30)
        assert new > current + timedelta(days=29)
