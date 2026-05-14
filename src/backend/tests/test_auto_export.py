"""
Tests for app.services.auto_export — auto-export brilliant clips + recap generation.

Covers every branch in auto_export_game, _export_brilliant_clip, _generate_recap,
_get_annotated_clips, and _set_game_status.
"""

import sqlite3
import time
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock, call

from app.utils.encoding import encode_data

# Module path prefix for patching
M = "app.services.auto_export"

USER_ID = "test-user-1"
PROFILE_ID = "testdefault"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def isolated_profile_db(tmp_path):
    """Create an isolated profile.sqlite with the games + raw_clips + final_videos
    tables so auto_export can run real SQL against it."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    db_dir = tmp_path / USER_ID / "profiles" / PROFILE_ID
    db_dir.mkdir(parents=True)
    db_path = db_dir / "profile.sqlite"

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript("""
        CREATE TABLE games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            blake3_hash TEXT,
            video_filename TEXT,
            clip_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'ready',
            auto_export_status TEXT,
            recap_video_url TEXT,
            video_size INTEGER,
            video_duration REAL,
            video_width INTEGER,
            video_height INTEGER,
            video_fps REAL,
            opponent_name TEXT,
            game_date TEXT,
            game_type TEXT,
            tournament_name TEXT,
            viewed_duration REAL DEFAULT 0,
            brilliant_count INTEGER DEFAULT 0,
            good_count INTEGER DEFAULT 0,
            interesting_count INTEGER DEFAULT 0,
            mistake_count INTEGER DEFAULT 0,
            blunder_count INTEGER DEFAULT 0,
            aggregate_score INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            rating INTEGER NOT NULL,
            tags BLOB,
            name TEXT,
            notes TEXT,
            start_time REAL,
            end_time REAL,
            game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
            auto_project_id INTEGER,
            video_sequence INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
            blake3_hash TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            duration REAL,
            UNIQUE(game_id, sequence)
        );
        CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            duration REAL,
            source_type TEXT,
            game_id INTEGER,
            name TEXT,
            published_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    conn.close()

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", {USER_ID}), \
         patch("app.database.R2_ENABLED", False), \
         patch(f"{M}.sync_db_to_r2_explicit", return_value=True) as mock_sync:
        yield {
            "db_path": db_path,
            "tmp_path": tmp_path,
            "mock_sync": mock_sync,
        }


def _insert_game(db_path, name="Test Game", blake3_hash="abc123", status=None):
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO games (name, blake3_hash, auto_export_status) VALUES (?, ?, ?)",
        (name, blake3_hash, status),
    )
    conn.commit()
    game_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    return game_id


def _insert_clip(db_path, game_id, rating=5, start=0.0, end=5.0, name="Goal",
                 auto_project_id=None, tags=None, notes=None):
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """INSERT INTO raw_clips (filename, rating, start_time, end_time,
           game_id, name, auto_project_id, tags, notes)
           VALUES ('clip.mp4', ?, ?, ?, ?, ?, ?, ?, ?)""",
        (rating, start, end, game_id, name, auto_project_id, tags, notes),
    )
    conn.commit()
    clip_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.close()
    return clip_id


def _get_game_status(db_path, game_id):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT auto_export_status, recap_video_url FROM games WHERE id = ?",
        (game_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def _count_final_videos(db_path, game_id):
    conn = sqlite3.connect(str(db_path))
    count = conn.execute(
        "SELECT COUNT(*) FROM final_videos WHERE game_id = ?", (game_id,)
    ).fetchone()[0]
    conn.close()
    return count


def _insert_final_video(db_path, game_id, project_id, filename="old_video.mp4"):
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """INSERT INTO final_videos (project_id, filename, version, source_type, game_id, name)
           VALUES (?, ?, 1, 'brilliant_clip', ?, 'Old Clip')""",
        (project_id, filename, game_id),
    )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# auto_export_game tests
# ---------------------------------------------------------------------------

class TestAutoExportGame:
    def test_game_not_found_returns_skipped(self, isolated_profile_db):
        from app.services.auto_export import auto_export_game

        result = auto_export_game(USER_ID, PROFILE_ID, 9999)
        assert result == "skipped"

    def test_already_complete_returns_complete(self, isolated_profile_db):
        from app.services.auto_export import auto_export_game

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db, status="complete")
        result = auto_export_game(USER_ID, PROFILE_ID, game_id)
        assert result == "complete"

    def test_pending_retries_instead_of_returning(self, isolated_profile_db):
        """After T2460: pending games are retried, not skipped."""
        from app.services.auto_export import auto_export_game

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db, status="pending")
        # No clips -> will be skipped after retry
        result = auto_export_game(USER_ID, PROFILE_ID, game_id)
        assert result == "skipped"
        assert _get_game_status(db, game_id)["auto_export_status"] == "skipped"

    @patch(f"{M}._generate_recap", return_value="recaps/1.mp4")
    @patch(f"{M}._export_brilliant_clip")
    def test_pending_retries_with_clips_completes(self, mock_brilliant, mock_recap, isolated_profile_db):
        """Pending game with clips completes on retry."""
        from app.services.auto_export import auto_export_game

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db, status="pending")
        _insert_clip(db, game_id, rating=5, name="Goal")

        result = auto_export_game(USER_ID, PROFILE_ID, game_id)
        assert result == "complete"
        mock_brilliant.assert_called_once()

    def test_no_clips_returns_skipped(self, isolated_profile_db):
        from app.services.auto_export import auto_export_game

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        result = auto_export_game(USER_ID, PROFILE_ID, game_id)
        assert result == "skipped"
        assert _get_game_status(db, game_id)["auto_export_status"] == "skipped"
        isolated_profile_db["mock_sync"].assert_called()

    @patch(f"{M}._generate_recap", return_value="recaps/1.mp4")
    @patch(f"{M}._export_brilliant_clip")
    def test_complete_with_5star_clips(self, mock_brilliant, mock_recap, isolated_profile_db):
        from app.services.auto_export import auto_export_game

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        _insert_clip(db, game_id, rating=5, name="Goal")
        _insert_clip(db, game_id, rating=3, name="Interesting")

        result = auto_export_game(USER_ID, PROFILE_ID, game_id)
        assert result == "complete"
        assert mock_brilliant.call_count == 1
        mock_recap.assert_called_once()

        status = _get_game_status(db, game_id)
        assert status["auto_export_status"] == "complete"
        assert status["recap_video_url"] == "recaps/1.mp4"

    @patch(f"{M}._generate_recap", return_value="recaps/1.mp4")
    @patch(f"{M}._export_brilliant_clip")
    def test_fallback_to_4star(self, mock_brilliant, mock_recap, isolated_profile_db):
        from app.services.auto_export import auto_export_game

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        _insert_clip(db, game_id, rating=4, name="Good")
        _insert_clip(db, game_id, rating=3, name="Interesting")

        result = auto_export_game(USER_ID, PROFILE_ID, game_id)
        assert result == "complete"
        assert mock_brilliant.call_count == 1

    @patch(f"{M}._generate_recap", return_value="recaps/1.mp4")
    @patch(f"{M}._export_brilliant_clip", side_effect=RuntimeError("ffmpeg boom"))
    def test_brilliant_clip_failure_doesnt_block(self, mock_brilliant, mock_recap, isolated_profile_db):
        from app.services.auto_export import auto_export_game

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        _insert_clip(db, game_id, rating=5)

        result = auto_export_game(USER_ID, PROFILE_ID, game_id)
        assert result == "complete"

    @patch(f"{M}._generate_recap", side_effect=RuntimeError("concat failed"))
    @patch(f"{M}._export_brilliant_clip")
    def test_recap_failure_marks_failed(self, mock_brilliant, mock_recap, isolated_profile_db):
        from app.services.auto_export import auto_export_game

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        _insert_clip(db, game_id, rating=5)

        result = auto_export_game(USER_ID, PROFILE_ID, game_id)
        assert result == "failed"
        assert _get_game_status(db, game_id)["auto_export_status"] == "failed"
        isolated_profile_db["mock_sync"].assert_called()

    @patch(f"{M}._generate_recap", return_value="recaps/1.mp4")
    @patch(f"{M}._export_brilliant_clip")
    def test_timing_logged(self, mock_brilliant, mock_recap, isolated_profile_db, caplog):
        """Verify timing information is present in log output."""
        import logging
        from app.services.auto_export import auto_export_game

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        _insert_clip(db, game_id, rating=5)

        with caplog.at_level(logging.INFO, logger="app.services.auto_export"):
            auto_export_game(USER_ID, PROFILE_ID, game_id)

        log_text = caplog.text
        assert "Starting game=" in log_text
        assert "complete in" in log_text
        assert "found" in log_text and "annotated clips" in log_text


# ---------------------------------------------------------------------------
# _export_brilliant_clip tests
# ---------------------------------------------------------------------------

class TestExportBrilliantClip:
    def _make_clip(self, clip_id=1, rating=5, auto_project_id=100):
        return {
            "id": clip_id,
            "name": "Goal",
            "rating": rating,
            "video_hash": "abc123",
            "start_time": 10.0,
            "end_time": 15.0,
            "auto_project_id": auto_project_id,
            "video_sequence": 1,
            "tags": None,
            "notes": None,
        }

    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/games/abc123.mp4?signed=1")
    @patch(f"{M}.ffmpeg")
    def test_exports_clip_via_presigned_url(self, mock_ffmpeg, mock_presign, mock_upload, isolated_profile_db):
        from app.services.auto_export import _export_brilliant_clip

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip = self._make_clip()

        _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        mock_presign.assert_called_once_with("games/abc123.mp4")
        mock_ffmpeg.input.assert_called_once()
        # Verify presigned URL is first arg and ss/to are kwargs
        call_args = mock_ffmpeg.input.call_args
        assert call_args[0][0] == "https://r2.example.com/games/abc123.mp4?signed=1"
        assert call_args[1]["ss"] == 10.0
        assert call_args[1]["to"] == 15.0
        mock_upload.assert_called_once()
        assert _count_final_videos(db, game_id) == 1

    @patch(f"{M}.generate_presigned_url_global", return_value=None)
    def test_presigned_url_failure_raises(self, mock_presign, isolated_profile_db):
        from app.services.auto_export import _export_brilliant_clip

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip = self._make_clip()

        with pytest.raises(RuntimeError, match="Failed to generate presigned URL"):
            _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

    def test_no_auto_project_id_skips(self, isolated_profile_db):
        from app.services.auto_export import _export_brilliant_clip

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip = self._make_clip()
        clip["auto_project_id"] = None

        _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)
        assert _count_final_videos(db, game_id) == 0

    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_clip_with_no_name_uses_fallback(self, mock_ffmpeg, mock_presign, mock_upload, isolated_profile_db):
        from app.services.auto_export import _export_brilliant_clip

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip = self._make_clip(clip_id=42)
        clip["name"] = None

        _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        fv = conn.execute("SELECT name FROM final_videos WHERE game_id = ?", (game_id,)).fetchone()
        conn.close()
        assert fv["name"] == "Clip 42"

    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.delete_from_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_re_export_replaces_old_final_video(self, mock_ffmpeg, mock_presign, mock_delete, mock_upload, isolated_profile_db):
        """When a brilliant clip was previously exported, the old record and R2 file are replaced."""
        from app.services.auto_export import _export_brilliant_clip

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip = self._make_clip(auto_project_id=200)
        _insert_final_video(db, game_id, project_id=200, filename="old_export.mp4")
        assert _count_final_videos(db, game_id) == 1

        _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        mock_delete.assert_called_once_with(USER_ID, "final_videos/old_export.mp4")
        assert _count_final_videos(db, game_id) == 1  # replaced, not added

    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.delete_from_r2", side_effect=RuntimeError("R2 delete failed"))
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_re_export_continues_if_old_delete_fails(self, mock_ffmpeg, mock_presign, mock_delete, mock_upload, isolated_profile_db):
        """If deleting the old R2 file fails, export still proceeds."""
        from app.services.auto_export import _export_brilliant_clip

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip = self._make_clip(auto_project_id=300)
        _insert_final_video(db, game_id, project_id=300, filename="old.mp4")

        _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        mock_upload.assert_called_once()
        assert _count_final_videos(db, game_id) == 1

    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_timing_logged(self, mock_ffmpeg, mock_presign, mock_upload, isolated_profile_db, caplog):
        """Verify timing info in log for brilliant clip export."""
        import logging
        from app.services.auto_export import _export_brilliant_clip

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip = self._make_clip()

        with caplog.at_level(logging.INFO, logger="app.services.auto_export"):
            _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        log_text = caplog.text
        assert "Brilliant clip=" in log_text
        assert "ffmpeg stream-copy in" in log_text
        assert "uploaded as" in log_text


# ---------------------------------------------------------------------------
# _generate_recap tests
# ---------------------------------------------------------------------------

class TestGenerateRecap:
    def _make_clips(self, video_hash="abc123"):
        return [
            {"id": 1, "video_hash": video_hash, "start_time": 0.0, "end_time": 5.0,
             "name": "Goal", "rating": 5, "tags": encode_data(["soccer"]), "notes": "Great shot"},
            {"id": 2, "video_hash": video_hash, "start_time": 10.0, "end_time": 15.0,
             "name": "Save", "rating": 4, "tags": None, "notes": None},
        ]

    @patch(f"{M}.upload_bytes_to_r2", return_value=True)
    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_recap_generates_concat(self, mock_ffmpeg, mock_presign, mock_upload, mock_upload_bytes, isolated_profile_db):
        from app.services.auto_export import _generate_recap

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.filter.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None
        mock_ffmpeg.probe.return_value = {"format": {"duration": "5.0"}}

        result = _generate_recap(USER_ID, PROFILE_ID, 1, self._make_clips())
        assert result == "recaps/1.mp4"
        mock_upload.assert_called_once()
        mock_upload_bytes.assert_called_once()

        # Verify clip_mapping JSON was uploaded
        clip_json_call = mock_upload_bytes.call_args
        assert clip_json_call[0][1] == "recaps/1_clips.json"

    @patch(f"{M}.upload_bytes_to_r2", return_value=True)
    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_recap_multi_video(self, mock_ffmpeg, mock_presign, mock_upload, mock_upload_bytes, isolated_profile_db):
        from app.services.auto_export import _generate_recap

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.filter.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None
        mock_ffmpeg.probe.return_value = {"format": {"duration": "5.0"}}

        clips = [
            {"id": 1, "video_hash": "hash_a", "start_time": 0.0, "end_time": 5.0,
             "name": "Clip1", "rating": 5, "tags": None, "notes": None},
            {"id": 2, "video_hash": "hash_b", "start_time": 0.0, "end_time": 3.0,
             "name": "Clip2", "rating": 4, "tags": None, "notes": None},
        ]
        result = _generate_recap(USER_ID, PROFILE_ID, 1, clips)
        assert result == "recaps/1.mp4"
        assert mock_presign.call_count == 2
        mock_presign.assert_any_call("games/hash_a.mp4")
        mock_presign.assert_any_call("games/hash_b.mp4")

    @patch(f"{M}.generate_presigned_url_global", return_value=None)
    def test_recap_all_urls_fail_raises(self, mock_presign, isolated_profile_db):
        from app.services.auto_export import _generate_recap

        with pytest.raises(RuntimeError, match="No clips extracted"):
            _generate_recap(USER_ID, PROFILE_ID, 1, self._make_clips())

    @patch(f"{M}.upload_bytes_to_r2", return_value=True)
    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global")
    @patch(f"{M}.ffmpeg")
    def test_recap_partial_url_failure_continues(self, mock_ffmpeg, mock_presign, mock_upload, mock_upload_bytes, isolated_profile_db):
        """If one video hash fails to get URL, others still process."""
        from app.services.auto_export import _generate_recap

        mock_presign.side_effect = lambda key: (
            "https://r2.example.com/signed" if "hash_a" in key else None
        )

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.filter.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None
        mock_ffmpeg.probe.return_value = {"format": {"duration": "5.0"}}

        clips = [
            {"id": 1, "video_hash": "hash_a", "start_time": 0.0, "end_time": 5.0,
             "name": "Clip1", "rating": 5, "tags": None, "notes": None},
            {"id": 2, "video_hash": "hash_b", "start_time": 0.0, "end_time": 3.0,
             "name": "Clip2", "rating": 4, "tags": None, "notes": None},
        ]
        result = _generate_recap(USER_ID, PROFILE_ID, 1, clips)
        assert result == "recaps/1.mp4"

    @patch(f"{M}.upload_bytes_to_r2", return_value=True)
    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_recap_clip_mapping_includes_tags_and_notes(self, mock_ffmpeg, mock_presign, mock_upload, mock_upload_bytes, isolated_profile_db):
        """Verify clip_mapping JSON contains correct metadata."""
        import json
        from app.services.auto_export import _generate_recap

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.filter.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None
        mock_ffmpeg.probe.return_value = {"format": {"duration": "4.5"}}

        clips = [
            {"id": 10, "video_hash": "abc", "start_time": 0.0, "end_time": 5.0,
             "name": "Goal", "rating": 5, "tags": encode_data(["header", "set-piece"]), "notes": "Corner kick"},
        ]
        _generate_recap(USER_ID, PROFILE_ID, 1, clips)

        clip_json = json.loads(mock_upload_bytes.call_args[0][2].decode())
        assert len(clip_json) == 1
        assert clip_json[0]["id"] == 10
        assert clip_json[0]["name"] == "Goal"
        assert clip_json[0]["rating"] == 5
        assert clip_json[0]["tags"] == ["header", "set-piece"]
        assert clip_json[0]["notes"] == "Corner kick"
        assert clip_json[0]["recap_start"] == 0.0
        assert clip_json[0]["recap_end"] == 4.5

    @patch(f"{M}.upload_bytes_to_r2", return_value=True)
    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_recap_timing_logged(self, mock_ffmpeg, mock_presign, mock_upload, mock_upload_bytes, isolated_profile_db, caplog):
        import logging
        from app.services.auto_export import _generate_recap

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.filter.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None
        mock_ffmpeg.probe.return_value = {"format": {"duration": "5.0"}}

        with caplog.at_level(logging.INFO, logger="app.services.auto_export"):
            _generate_recap(USER_ID, PROFILE_ID, 1, self._make_clips())

        log_text = caplog.text
        assert "Recap game=1 starting with 2 clips" in log_text
        assert "unique video sources" in log_text
        assert "extracted" in log_text
        assert "complete in" in log_text


# ---------------------------------------------------------------------------
# _get_annotated_clips + _set_game_status tests
# ---------------------------------------------------------------------------

class TestHelpers:
    def test_get_annotated_clips_returns_all_rated(self, isolated_profile_db):
        from app.services.auto_export import _get_annotated_clips

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        other_game_id = _insert_game(db, name="Other Game")

        _insert_clip(db, game_id, rating=5, start=0.0, end=5.0, name="Goal")
        _insert_clip(db, game_id, rating=3, start=10.0, end=15.0, name="Interesting")
        # Clip from a different game should be excluded
        _insert_clip(db, other_game_id, rating=5, start=0.0, end=5.0, name="Other")

        clips = _get_annotated_clips(game_id)
        assert len(clips) == 2
        assert clips[0]["name"] == "Goal"
        assert clips[1]["name"] == "Interesting"

    def test_get_annotated_clips_empty_game(self, isolated_profile_db):
        from app.services.auto_export import _get_annotated_clips

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)

        clips = _get_annotated_clips(game_id)
        assert clips == []

    def test_get_annotated_clips_resolves_game_videos_hash(self, isolated_profile_db):
        """Clips from multi-video games resolve hash from game_videos table."""
        from app.services.auto_export import _get_annotated_clips

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db, blake3_hash=None)

        conn = sqlite3.connect(str(db))
        conn.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (?, ?, ?)",
            (game_id, "multi_hash_1", 1),
        )
        conn.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (?, ?, ?)",
            (game_id, "multi_hash_2", 2),
        )
        conn.commit()
        conn.close()

        _insert_clip(db, game_id, rating=5, start=0.0, end=5.0, name="Seq1 clip")

        clips = _get_annotated_clips(game_id)
        assert len(clips) == 1
        assert clips[0]["video_hash"] == "multi_hash_1"

    def test_set_game_status(self, isolated_profile_db):
        from app.services.auto_export import _set_game_status

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)

        _set_game_status(game_id, "failed")
        assert _get_game_status(db, game_id)["auto_export_status"] == "failed"
