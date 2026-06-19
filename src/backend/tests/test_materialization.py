"""
Tests for game + annotation materialization (T2830).

Tests the core materialization logic: clip filtering, overlap detection/merging,
game copying, storage ref creation, and pending share CRUD.
"""

import json
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from app.utils.encoding import encode_data, decode_data
from app.services.materialization import (
    clips_overlap,
    merge_clips,
    _filter_clips_for_tag,
    _find_existing_game_by_hashes,
    _copy_game,
    _materialize_clips,
    _collect_video_hashes,
    materialize_game_share,
    serialize_clip_data,
)


# ---------------------------------------------------------------------------
# Helpers: create in-memory SQLite databases with the right schema
# ---------------------------------------------------------------------------

def _create_profile_db(path: Path) -> sqlite3.Connection:
    """Create a profile SQLite with the tables needed for materialization."""
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
        CREATE INDEX IF NOT EXISTS idx_clip_teammates_tag ON clip_teammates(tag_name);
    """)
    conn.commit()
    return conn


def _insert_game(conn, name="Test Game", blake3_hash="abc123", **kwargs):
    """Insert a game row and return its id."""
    defaults = dict(
        video_duration=90.0, video_width=1920, video_height=1080,
        video_size=100000, opponent_name="Opponent", game_date="2026-05-01",
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
         defaults["video_height"], defaults["video_size"], defaults["opponent_name"],
         defaults["game_date"], defaults["game_type"], defaults["tournament_name"],
         defaults["video_fps"]),
    )
    conn.commit()
    return cur.lastrowid


def _insert_game_video(conn, game_id, blake3_hash, sequence=0, **kwargs):
    """Insert a game_videos row."""
    defaults = dict(duration=45.0, video_width=1920, video_height=1080,
                    video_size=50000, fps=30.0)
    defaults.update(kwargs)
    conn.execute(
        """INSERT INTO game_videos (game_id, blake3_hash, sequence, duration,
           video_width, video_height, video_size, fps)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (game_id, blake3_hash, sequence, defaults["duration"],
         defaults["video_width"], defaults["video_height"],
         defaults["video_size"], defaults["fps"]),
    )
    conn.commit()


def _insert_clip(conn, game_id, start_time, end_time, tagged_teammates=None,
                 name=None, rating=3, notes=None, video_sequence=None):
    """Insert a raw_clip row and return its id."""
    tt_encoded = encode_data(tagged_teammates) if tagged_teammates else None
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO raw_clips (filename, rating, name, notes, start_time,
           end_time, game_id, video_sequence, tagged_teammates, my_athlete)
           VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
        (rating, name, notes, start_time, end_time, game_id, video_sequence,
         tt_encoded),
    )
    clip_id = cur.lastrowid
    if tagged_teammates:
        for tag in tagged_teammates:
            cur.execute(
                "INSERT OR IGNORE INTO clip_teammates (clip_id, tag_name) VALUES (?, ?)",
                (clip_id, tag),
            )
    conn.commit()
    return clip_id


# ===========================================================================
# Unit tests: clip filtering
# ===========================================================================

class TestFilterClipsForTag:
    def test_filters_by_tag_name(self, tmp_path):
        db_path = tmp_path / "sharer" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)
        _insert_clip(conn, game_id, 0.0, 5.0, tagged_teammates=["Jake", "Player 7"], name="Clip 1")
        _insert_clip(conn, game_id, 5.0, 10.0, tagged_teammates=["Jake"], name="Clip 2")
        _insert_clip(conn, game_id, 10.0, 15.0, tagged_teammates=["Player 7"], name="Clip 3")
        _insert_clip(conn, game_id, 15.0, 20.0, tagged_teammates=None, name="Clip 4")

        jake_clips = _filter_clips_for_tag(conn, game_id, "Jake")
        assert len(jake_clips) == 2
        assert jake_clips[0]["name"] == "Clip 1"
        assert jake_clips[1]["name"] == "Clip 2"

        p7_clips = _filter_clips_for_tag(conn, game_id, "Player 7")
        assert len(p7_clips) == 2
        assert p7_clips[0]["name"] == "Clip 1"
        assert p7_clips[1]["name"] == "Clip 3"

        nobody_clips = _filter_clips_for_tag(conn, game_id, "Nobody")
        assert len(nobody_clips) == 0

        conn.close()

    def test_returns_correct_fields(self, tmp_path):
        db_path = tmp_path / "sharer" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)
        _insert_clip(conn, game_id, 1.5, 3.5, tagged_teammates=["Jake"],
                     name="Goal", rating=5, notes="Great shot", video_sequence=0)

        clips = _filter_clips_for_tag(conn, game_id, "Jake")
        assert len(clips) == 1
        c = clips[0]
        assert c["start_time"] == 1.5
        assert c["end_time"] == 3.5
        assert c["name"] == "Goal"
        assert c["rating"] == 5
        assert c["notes"] == "Great shot"
        assert c["video_sequence"] == 0
        assert c["tagged_teammates"] == ["Jake"]
        conn.close()


# ===========================================================================
# Unit tests: overlap detection
# ===========================================================================

class TestClipsOverlap:
    def test_overlapping_same_sequence(self):
        a = {"start_time": 0, "end_time": 5, "video_sequence": 0}
        b = {"start_time": 3, "end_time": 8, "video_sequence": 0}
        assert clips_overlap(a, b) is True

    def test_non_overlapping_same_sequence(self):
        a = {"start_time": 0, "end_time": 5, "video_sequence": 0}
        b = {"start_time": 5, "end_time": 10, "video_sequence": 0}
        assert clips_overlap(a, b) is False

    def test_different_sequence_no_overlap(self):
        a = {"start_time": 0, "end_time": 5, "video_sequence": 0}
        b = {"start_time": 3, "end_time": 8, "video_sequence": 1}
        assert clips_overlap(a, b) is False

    def test_contained_clip(self):
        a = {"start_time": 0, "end_time": 10, "video_sequence": None}
        b = {"start_time": 2, "end_time": 7, "video_sequence": None}
        assert clips_overlap(a, b) is True

    def test_touching_boundary_no_overlap(self):
        a = {"start_time": 0, "end_time": 5, "video_sequence": 0}
        b = {"start_time": 5, "end_time": 10, "video_sequence": 0}
        assert clips_overlap(a, b) is False

    def test_none_sequence_matches(self):
        a = {"start_time": 0, "end_time": 5, "video_sequence": None}
        b = {"start_time": 3, "end_time": 8, "video_sequence": None}
        assert clips_overlap(a, b) is True


# ===========================================================================
# Unit tests: merge logic
# ===========================================================================

class TestMergeClips:
    def test_basic_merge(self):
        existing = {"start_time": 0, "end_time": 5, "name": "Clip A",
                     "notes": "Note A", "rating": 4, "video_sequence": 0}
        incoming = {"start_time": 3, "end_time": 8, "name": "Clip B",
                     "notes": "Note B", "rating": 5, "video_sequence": 0}
        result = merge_clips(existing, incoming)
        assert result["start_time"] == 0
        assert result["end_time"] == 8
        assert result["name"] == "Clip A"
        assert "Note A" in result["notes"]
        assert "Note B" in result["notes"]

    def test_merge_with_empty_notes(self):
        existing = {"start_time": 0, "end_time": 5, "name": "A", "notes": None,
                     "rating": 3, "video_sequence": 0}
        incoming = {"start_time": 3, "end_time": 8, "name": "B", "notes": "Some note",
                     "rating": 3, "video_sequence": 0}
        result = merge_clips(existing, incoming)
        assert result["notes"] == "Some note"

    def test_merge_both_empty_notes(self):
        existing = {"start_time": 0, "end_time": 5, "name": "A", "notes": None,
                     "rating": 3, "video_sequence": 0}
        incoming = {"start_time": 3, "end_time": 8, "name": "B", "notes": None,
                     "rating": 3, "video_sequence": 0}
        result = merge_clips(existing, incoming)
        assert result["notes"] is None

    def test_merge_preserves_earliest_start(self):
        existing = {"start_time": 5, "end_time": 10, "name": "A", "notes": None,
                     "rating": 3, "video_sequence": 0}
        incoming = {"start_time": 3, "end_time": 8, "name": "B", "notes": None,
                     "rating": 3, "video_sequence": 0}
        result = merge_clips(existing, incoming)
        assert result["start_time"] == 3
        assert result["end_time"] == 10


# ===========================================================================
# Unit tests: game dedup by hash
# ===========================================================================

class TestFindExistingGameByHashes:
    def test_finds_single_video_game(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn, blake3_hash="hash_abc")

        found = _find_existing_game_by_hashes(conn, ["hash_abc"])
        assert found == game_id
        conn.close()

    def test_finds_multi_video_game(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn, blake3_hash=None)
        _insert_game_video(conn, game_id, "hash_1", sequence=0)
        _insert_game_video(conn, game_id, "hash_2", sequence=1)

        found = _find_existing_game_by_hashes(conn, ["hash_1", "hash_2"])
        assert found == game_id
        conn.close()

    def test_returns_none_when_no_match(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        _insert_game(conn, blake3_hash="different_hash")

        found = _find_existing_game_by_hashes(conn, ["hash_abc"])
        assert found is None
        conn.close()

    def test_empty_hashes(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        found = _find_existing_game_by_hashes(conn, [])
        assert found is None
        conn.close()


# ===========================================================================
# Unit tests: game copying
# ===========================================================================

class TestCopyGame:
    def test_copies_game_metadata(self, tmp_path):
        sharer_db = tmp_path / "sharer" / "profile.sqlite"
        recipient_db = tmp_path / "recipient" / "profile.sqlite"
        s_conn = _create_profile_db(sharer_db)
        r_conn = _create_profile_db(recipient_db)

        game_id = _insert_game(s_conn, name="Big Game", blake3_hash="abc",
                               opponent_name="Rival FC")

        new_id = _copy_game(s_conn, r_conn, game_id)
        r_conn.commit()

        row = r_conn.execute("SELECT * FROM games WHERE id = ?", (new_id,)).fetchone()
        assert row["name"] == "Big Game"
        assert row["blake3_hash"] == "abc"
        assert row["opponent_name"] == "Rival FC"
        assert row["video_filename"] is None
        assert row["status"] == "ready"

        s_conn.close()
        r_conn.close()

    def test_copies_game_videos(self, tmp_path):
        sharer_db = tmp_path / "sharer" / "profile.sqlite"
        recipient_db = tmp_path / "recipient" / "profile.sqlite"
        s_conn = _create_profile_db(sharer_db)
        r_conn = _create_profile_db(recipient_db)

        game_id = _insert_game(s_conn, blake3_hash=None)
        _insert_game_video(s_conn, game_id, "hash_a", sequence=0, fps=30.0)
        _insert_game_video(s_conn, game_id, "hash_b", sequence=1, fps=30.0)

        new_id = _copy_game(s_conn, r_conn, game_id)
        r_conn.commit()

        videos = r_conn.execute(
            "SELECT * FROM game_videos WHERE game_id = ? ORDER BY sequence",
            (new_id,),
        ).fetchall()
        assert len(videos) == 2
        assert videos[0]["blake3_hash"] == "hash_a"
        assert videos[1]["blake3_hash"] == "hash_b"
        assert videos[0]["game_id"] == new_id

        s_conn.close()
        r_conn.close()


# ===========================================================================
# Unit tests: clip materialization with overlap merging
# ===========================================================================

class TestMaterializeClips:
    def test_inserts_new_clips(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        incoming = [
            {"rating": 5, "name": "Goal", "notes": "Beautiful", "start_time": 0,
             "end_time": 5, "video_sequence": 0, "tags": None},
            {"rating": 3, "name": "Pass", "notes": None, "start_time": 10,
             "end_time": 15, "video_sequence": 0, "tags": None},
        ]

        result = _materialize_clips(conn, game_id, incoming)
        conn.commit()

        assert result["inserted"] == 2
        assert result["merged"] == 0

        clips = conn.execute(
            "SELECT * FROM raw_clips WHERE game_id = ? ORDER BY start_time",
            (game_id,),
        ).fetchall()
        assert len(clips) == 2
        assert clips[0]["name"] == "Goal"
        assert clips[0]["my_athlete"] == 0
        assert clips[0]["filename"] == ""

        conn.close()

    def test_merges_overlapping_clips(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        # Existing clip
        _insert_clip(conn, game_id, 0, 5, name="Existing", notes="Note A",
                     video_sequence=0)

        # Incoming overlapping clip
        incoming = [
            {"rating": 4, "name": "Incoming", "notes": "Note B",
             "start_time": 3, "end_time": 8, "video_sequence": 0, "tags": None},
        ]

        result = _materialize_clips(conn, game_id, incoming)
        conn.commit()

        assert result["inserted"] == 0
        assert result["merged"] == 1

        clips = conn.execute(
            "SELECT * FROM raw_clips WHERE game_id = ?", (game_id,),
        ).fetchall()
        assert len(clips) == 1
        assert clips[0]["start_time"] == 0
        assert clips[0]["end_time"] == 8
        assert clips[0]["name"] == "Existing"
        assert "Note A" in clips[0]["notes"]
        assert "Note B" in clips[0]["notes"]

        conn.close()

    def test_mixed_overlap_and_new(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        _insert_clip(conn, game_id, 0, 5, name="Existing", video_sequence=0)

        incoming = [
            {"rating": 3, "name": "Overlap", "notes": None, "start_time": 3,
             "end_time": 7, "video_sequence": 0, "tags": None},
            {"rating": 5, "name": "New", "notes": None, "start_time": 20,
             "end_time": 25, "video_sequence": 0, "tags": None},
        ]

        result = _materialize_clips(conn, game_id, incoming)
        conn.commit()

        assert result["inserted"] == 1
        assert result["merged"] == 1

        clips = conn.execute(
            "SELECT * FROM raw_clips WHERE game_id = ? ORDER BY start_time",
            (game_id,),
        ).fetchall()
        assert len(clips) == 2

        conn.close()


# ===========================================================================
# Unit tests: athlete attribution on materialized clips
# ===========================================================================

class TestAthleteAttribution:
    def test_inserts_with_sharer_profile_name(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        incoming = [
            {"rating": 5, "name": "Goal", "notes": None, "start_time": 0,
             "end_time": 5, "video_sequence": 0, "tags": None,
             "tagged_teammates": ["Sam"]},
        ]

        result = _materialize_clips(conn, game_id, incoming, sharer_profile_name="Jake Johnson")
        conn.commit()

        assert result["inserted"] == 1
        clips = conn.execute("SELECT * FROM raw_clips WHERE game_id = ?", (game_id,)).fetchall()
        athletes = decode_data(clips[0]["tagged_teammates"])
        assert sorted(athletes) == ["Jake Johnson", "Sam"]
        assert clips[0]["my_athlete"] == 0
        conn.close()

    def test_inserts_with_no_sharer_name(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        incoming = [
            {"rating": 3, "name": "Play", "notes": None, "start_time": 0,
             "end_time": 5, "video_sequence": 0, "tags": None,
             "tagged_teammates": ["Sam"]},
        ]

        result = _materialize_clips(conn, game_id, incoming, sharer_profile_name=None)
        conn.commit()

        clips = conn.execute("SELECT * FROM raw_clips WHERE game_id = ?", (game_id,)).fetchall()
        athletes = decode_data(clips[0]["tagged_teammates"])
        assert athletes == ["Sam"]
        conn.close()

    def test_merge_unions_athlete_lists(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        # Existing clip from a prior share (has athletes from Player A's parent)
        conn.execute(
            """INSERT INTO raw_clips
               (filename, rating, name, start_time, end_time, game_id, video_sequence,
                tagged_teammates, my_athlete, shared_by)
               VALUES ('', 3, 'Existing', 0, 5, ?, 0, ?, 0, 'a@test.com')""",
            (game_id, encode_data(["Player A"])),
        )
        conn.commit()

        # Incoming overlapping clip from Player B's parent
        incoming = [
            {"rating": 4, "name": "Overlap", "notes": None, "start_time": 3,
             "end_time": 8, "video_sequence": 0, "tags": None,
             "tagged_teammates": ["Player C"]},
        ]

        result = _materialize_clips(
            conn, game_id, incoming,
            shared_by="b@test.com", sharer_profile_name="Player B",
        )
        conn.commit()

        assert result["merged"] == 1
        clips = conn.execute("SELECT * FROM raw_clips WHERE game_id = ?", (game_id,)).fetchall()
        assert len(clips) == 1
        athletes = decode_data(clips[0]["tagged_teammates"])
        assert sorted(athletes) == ["Player A", "Player B", "Player C"]
        conn.close()

    def test_no_tagged_teammates_gets_sharer_name_only(self, tmp_path):
        db_path = tmp_path / "recipient" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn)

        incoming = [
            {"rating": 3, "name": "Solo", "notes": None, "start_time": 0,
             "end_time": 5, "video_sequence": 0, "tags": None},
        ]

        result = _materialize_clips(conn, game_id, incoming, sharer_profile_name="Jake")
        conn.commit()

        clips = conn.execute("SELECT * FROM raw_clips WHERE game_id = ?", (game_id,)).fetchall()
        athletes = decode_data(clips[0]["tagged_teammates"])
        assert athletes == ["Jake"]
        conn.close()


# ===========================================================================
# Unit tests: video hash collection
# ===========================================================================

class TestCollectVideoHashes:
    def test_single_video_game(self, tmp_path):
        db_path = tmp_path / "db" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn, blake3_hash="single_hash")

        hashes = _collect_video_hashes(conn, game_id)
        assert hashes == ["single_hash"]
        conn.close()

    def test_multi_video_game(self, tmp_path):
        db_path = tmp_path / "db" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        game_id = _insert_game(conn, blake3_hash=None)
        _insert_game_video(conn, game_id, "h1", sequence=0)
        _insert_game_video(conn, game_id, "h2", sequence=1)

        hashes = _collect_video_hashes(conn, game_id)
        assert hashes == ["h1", "h2"]
        conn.close()

    def test_nonexistent_game(self, tmp_path):
        db_path = tmp_path / "db" / "profile.sqlite"
        conn = _create_profile_db(db_path)
        hashes = _collect_video_hashes(conn, 999)
        assert hashes == []
        conn.close()


# ===========================================================================
# Unit tests: serialize_clip_data
# ===========================================================================

class TestSerializeClipData:
    def test_serializes_to_msgpack(self):
        clips = [
            {"rating": 5, "name": "Goal", "notes": "Great", "start_time": 0,
             "end_time": 5, "video_sequence": 0, "tags": None,
             "tagged_teammates": ["Jake", "Sam"],
             "extra_field": "should_be_dropped"},
        ]
        result = serialize_clip_data(clips)
        assert isinstance(result, bytes)
        parsed = decode_data(result)
        assert len(parsed) == 1
        assert parsed[0]["name"] == "Goal"
        assert parsed[0]["tagged_teammates"] == ["Jake", "Sam"]
        assert "extra_field" not in parsed[0]


# ===========================================================================
# Integration tests: full materialize_game_share
# ===========================================================================

class TestMaterializeGameShare:
    def _setup_dbs(self, tmp_path):
        """Create sharer and recipient profile DBs under tmp_path as USER_DATA_BASE."""
        sharer_path = tmp_path / "sharer-user" / "profiles" / "sharer-profile" / "profile.sqlite"
        recipient_path = tmp_path / "recipient-user" / "profiles" / "recipient-profile" / "profile.sqlite"
        s_conn = _create_profile_db(sharer_path)
        r_conn = _create_profile_db(recipient_path)
        return s_conn, r_conn

    @patch("app.services.materialization.mark_game_share_materialized")
    @patch("app.services.materialization.insert_game_storage_ref")
    @patch("app.services.materialization.get_game_storage_ref")
    @patch("app.services.materialization.USER_DATA_BASE")
    def test_full_materialization(self, mock_base, mock_get_ref, mock_insert_ref,
                                  mock_mark, tmp_path):
        mock_base.__truediv__ = lambda self, x: tmp_path / x
        # Make Path operations work on mock
        type(mock_base).__truediv__ = lambda self, x: tmp_path / x

        s_conn, r_conn = self._setup_dbs(tmp_path)
        game_id = _insert_game(s_conn, name="League Match", blake3_hash="game_hash_1")
        _insert_clip(s_conn, game_id, 0, 5, tagged_teammates=["Jake"], name="Jake Goal")
        _insert_clip(s_conn, game_id, 10, 15, tagged_teammates=["Other"], name="Other Play")

        mock_get_ref.return_value = {
            "game_size_bytes": 100000,
            "storage_expires_at": "2027-01-01T00:00:00+00:00",
        }

        with patch("app.services.materialization.USER_DATA_BASE", tmp_path):
            result = materialize_game_share(
                sharer_user_id="sharer-user",
                sharer_profile_id="sharer-profile",
                recipient_user_id="recipient-user",
                recipient_profile_id="recipient-profile",
                game_id=game_id,
                tag_name="Jake",
                share_id=1,
            )

        assert result["skipped"] is False
        assert result["inserted"] == 1
        assert result["merged"] == 0
        assert result["game_id"] is not None

        # Verify game was created in recipient's DB
        r_conn2 = sqlite3.connect(
            str(tmp_path / "recipient-user" / "profiles" / "recipient-profile" / "profile.sqlite")
        )
        r_conn2.row_factory = sqlite3.Row
        games = r_conn2.execute("SELECT * FROM games").fetchall()
        assert len(games) == 1
        assert games[0]["name"] == "League Match"
        assert games[0]["video_filename"] is None

        clips = r_conn2.execute("SELECT * FROM raw_clips").fetchall()
        assert len(clips) == 1
        assert clips[0]["name"] == "Jake Goal"
        assert clips[0]["my_athlete"] == 0

        mock_mark.assert_called_once_with(1, "recipient-profile")
        mock_insert_ref.assert_called_once()

        s_conn.close()
        r_conn.close()
        r_conn2.close()

    @patch("app.services.materialization.mark_game_share_materialized")
    @patch("app.services.materialization.insert_game_storage_ref")
    @patch("app.services.materialization.get_game_storage_ref")
    def test_materialization_with_existing_game_merges(
        self, mock_get_ref, mock_insert_ref, mock_mark, tmp_path
    ):
        s_conn, r_conn = self._setup_dbs(tmp_path)

        # Sharer has a game with clips
        s_game_id = _insert_game(s_conn, name="Match", blake3_hash="same_hash")
        _insert_clip(s_conn, s_game_id, 0, 5, tagged_teammates=["Jake"], name="Goal 1")
        _insert_clip(s_conn, s_game_id, 10, 15, tagged_teammates=["Jake"], name="Goal 2")

        # Recipient already has the same game (dedup by hash)
        r_game_id = _insert_game(r_conn, name="Match", blake3_hash="same_hash")
        _insert_clip(r_conn, r_game_id, 3, 8, name="Existing clip", video_sequence=None)
        r_conn.commit()

        mock_get_ref.return_value = {
            "game_size_bytes": 50000,
            "storage_expires_at": "2027-01-01T00:00:00+00:00",
        }

        with patch("app.services.materialization.USER_DATA_BASE", tmp_path):
            result = materialize_game_share(
                sharer_user_id="sharer-user",
                sharer_profile_id="sharer-profile",
                recipient_user_id="recipient-user",
                recipient_profile_id="recipient-profile",
                game_id=s_game_id,
                tag_name="Jake",
                share_id=2,
            )

        assert result["game_id"] == r_game_id
        # Goal 1 (0-5) overlaps with existing (3-8) -> merge
        # Goal 2 (10-15) is new -> insert
        assert result["merged"] == 1
        assert result["inserted"] == 1

        s_conn.close()
        r_conn.close()

    @patch("app.services.materialization.mark_game_share_materialized")
    @patch("app.services.materialization.insert_game_storage_ref")
    @patch("app.services.materialization.get_game_storage_ref")
    def test_game_only_share_when_no_clips_for_tag(
        self, mock_get_ref, mock_insert_ref, mock_mark, tmp_path
    ):
        """No clips match tag -> game-only share (game copied, zero clips)."""
        s_conn, r_conn = self._setup_dbs(tmp_path)
        s_game_id = _insert_game(s_conn, name="Match")
        _insert_clip(s_conn, s_game_id, 0, 5, tagged_teammates=["Other"])

        mock_get_ref.return_value = {
            "game_size_bytes": 50000,
            "storage_expires_at": "2027-01-01T00:00:00+00:00",
        }

        with patch("app.services.materialization.USER_DATA_BASE", tmp_path):
            result = materialize_game_share(
                sharer_user_id="sharer-user",
                sharer_profile_id="sharer-profile",
                recipient_user_id="recipient-user",
                recipient_profile_id="recipient-profile",
                game_id=s_game_id,
                tag_name="Jake",
                share_id=3,
            )

        assert result["skipped"] is False
        assert result["game_id"] is not None
        assert result["inserted"] == 0
        assert result["merged"] == 0
        mock_mark.assert_called_once()

        s_conn.close()
        r_conn.close()

    @patch("app.services.materialization.mark_game_share_materialized")
    @patch("app.services.materialization.insert_game_storage_ref")
    @patch("app.services.materialization.get_game_storage_ref")
    def test_materializes_from_clip_data(
        self, mock_get_ref, mock_insert_ref, mock_mark, tmp_path
    ):
        """Test materialization with pre-serialized clip_data (pending share path)."""
        s_conn, r_conn = self._setup_dbs(tmp_path)
        s_game_id = _insert_game(s_conn, name="Match", blake3_hash="pending_hash")

        clip_data = [
            {"rating": 5, "name": "Provided clip", "notes": None,
             "start_time": 0, "end_time": 5, "video_sequence": 0, "tags": None},
        ]

        mock_get_ref.return_value = {
            "game_size_bytes": 50000,
            "storage_expires_at": "2027-01-01T00:00:00+00:00",
        }

        with patch("app.services.materialization.USER_DATA_BASE", tmp_path):
            result = materialize_game_share(
                sharer_user_id="sharer-user",
                sharer_profile_id="sharer-profile",
                recipient_user_id="recipient-user",
                recipient_profile_id="recipient-profile",
                game_id=s_game_id,
                tag_name="Jake",
                share_id=4,
                clip_data=clip_data,
            )

        assert result["skipped"] is False
        assert result["inserted"] == 1

        s_conn.close()
        r_conn.close()


# ===========================================================================
# Integration tests: pending share CRUD (requires pg_conn fixture)
# ===========================================================================

class TestPendingShareCRUD:
    def test_create_and_query_pending_share(self, pg_conn):
        from app.services.auth_db import create_user
        from app.services.sharing_db import (
            create_game_share, create_pending_share,
            get_pending_shares_for_email, resolve_pending_share,
        )

        create_user("sharer-user", email="sharer@test.com")

        share = create_game_share(
            game_id=1, tag_name="Jake",
            sharer_user_id="sharer-user",
            sharer_profile_id="sharer-profile",
            recipient_email="recipient@test.com",
        )

        from app.services.sharing_db import get_share_by_token
        share_record = get_share_by_token(share["share_token"])

        pending_id = create_pending_share(
            share_id=share_record["id"],
            sharer_user_id="sharer-user",
            sharer_profile_id="sharer-profile",
            recipient_email="recipient@test.com",
            game_id=1,
            tag_name="Jake",
            clip_data_bytes=encode_data([{"name": "Test clip"}]),
        )
        assert pending_id > 0

        pending = get_pending_shares_for_email("recipient@test.com")
        assert len(pending) == 1
        assert pending[0]["tag_name"] == "Jake"
        assert pending[0]["game_id"] == 1

        resolved = resolve_pending_share(pending_id, "recipient-profile")
        assert resolved is True

        # After resolution, should not appear in unresolved list
        pending_after = get_pending_shares_for_email("recipient@test.com")
        assert len(pending_after) == 0

    def test_pending_share_cascade_on_share_delete(self, pg_conn):
        from app.services.auth_db import create_user
        from app.services.sharing_db import (
            create_game_share, create_pending_share,
            get_pending_shares_for_email, revoke_share,
        )
        from app.services.pg import get_pg

        create_user("sharer-user", email="sharer2@test.com")

        share = create_game_share(
            game_id=2, tag_name="Player 7",
            sharer_user_id="sharer-user",
            sharer_profile_id="sharer-profile",
            recipient_email="new-user@test.com",
        )

        from app.services.sharing_db import get_share_by_token
        share_record = get_share_by_token(share["share_token"])

        create_pending_share(
            share_id=share_record["id"],
            sharer_user_id="sharer-user",
            sharer_profile_id="sharer-profile",
            recipient_email="new-user@test.com",
            game_id=2,
            tag_name="Player 7",
            clip_data_bytes=encode_data([]),
        )

        # Deleting the share should cascade to pending_teammate_shares
        with get_pg() as conn:
            cur = conn.cursor()
            cur.execute("DELETE FROM shares WHERE id = %s", (share_record["id"],))

        pending = get_pending_shares_for_email("new-user@test.com")
        assert len(pending) == 0
