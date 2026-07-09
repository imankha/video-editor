"""
Tests for app.services.auto_export — auto-export brilliant clips + recap generation.

Covers every branch in auto_export_game, _export_brilliant_clip, _generate_recap,
_get_annotated_clips, and _set_game_status.
"""

import json
import sqlite3
from unittest.mock import MagicMock, patch

import pytest

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
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

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
            auto_export_attempts INTEGER DEFAULT 0,
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
            video_width INTEGER,
            video_height INTEGER,
            fps REAL,
            UNIQUE(game_id, sequence)
        );
        CREATE TABLE projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            aspect_ratio TEXT NOT NULL,
            is_auto_created INTEGER DEFAULT 0,
            working_video_id INTEGER,
            final_video_id INTEGER,
            archived_at TIMESTAMP,
            restored_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            raw_clip_id INTEGER,
            uploaded_filename TEXT,
            sort_order INTEGER DEFAULT 0,
            version INTEGER NOT NULL DEFAULT 1,
            raw_clip_version INTEGER,
            width INTEGER,
            height INTEGER,
            fps REAL
        );
        CREATE TABLE working_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            duration REAL
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
            aspect_ratio TEXT,
            tags BLOB,
            game_ids BLOB,
            clip_count INTEGER DEFAULT 1,
            quality_score REAL,
            rating REAL,
            rd REAL,
            match_count INTEGER DEFAULT 0,
            source_clip_id INTEGER,
            clip_start_time REAL,
            clip_game_start_time REAL,
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


def _insert_project(db_path, project_id, name="Clip 7", aspect_ratio="9:16"):
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "INSERT INTO projects (id, name, aspect_ratio, is_auto_created) VALUES (?, ?, ?, 1)",
        (project_id, name, aspect_ratio),
    )
    conn.commit()
    conn.close()


def _insert_published_final(db_path, game_id, project_id, source_clip_id,
                            filename="framed.mp4", aspect_ratio="9:16"):
    """Insert a published (framed) final_videos row carrying source_clip_id, as a
    real match-played reel would. Distinct from _insert_final_video, which leaves
    published_at/source_clip_id NULL (the T4010 re-export placeholder)."""
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """INSERT INTO final_videos
           (project_id, filename, version, source_type, game_id, name,
            published_at, aspect_ratio, source_clip_id, match_count, rating)
           VALUES (?, ?, 1, 'brilliant_clip', ?, 'Framed Reel',
                   CURRENT_TIMESTAMP, ?, ?, 7, 1500.0)""",
        (project_id, filename, game_id, aspect_ratio, source_clip_id),
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

    @patch(f"{M}._generate_recap", side_effect=RuntimeError("concat failed"))
    @patch(f"{M}._export_brilliant_clip")
    def test_each_run_increments_attempts(self, mock_brilliant, mock_recap, isolated_profile_db):
        """Bug 23p: every run bumps auto_export_attempts so the sweep can cap retries."""
        from app.services.auto_export import auto_export_game

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        _insert_clip(db, game_id, rating=5)

        def _attempts():
            conn = sqlite3.connect(str(db))
            n = conn.execute(
                "SELECT auto_export_attempts FROM games WHERE id = ?", (game_id,)
            ).fetchone()[0]
            conn.close()
            return n

        auto_export_game(USER_ID, PROFILE_ID, game_id)
        assert _attempts() == 1
        auto_export_game(USER_ID, PROFILE_ID, game_id)
        assert _attempts() == 2

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
    """T4175: the sweep now preserves never-framed clips as frameable Reel Drafts
    (extract in raw_clips/, raw_clips.filename wired, no publish, no archive) —
    NOT as raw 16:9 published reels."""

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

    def _seed_draft(self, db, game_id, project_id=100, with_working_clip=True):
        """Insert a raw_clip + its auto-project draft (as annotate-time
        _create_auto_project_for_clip would). Returns the raw_clip id."""
        _insert_project(db, project_id)
        clip_id = _insert_clip(db, game_id, rating=5, name="Goal",
                               auto_project_id=project_id)
        if with_working_clip:
            conn = sqlite3.connect(str(db))
            conn.execute(
                "INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version) "
                "VALUES (?, ?, 0, 1)",
                (project_id, clip_id),
            )
            conn.commit()
            conn.close()
        return clip_id

    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/games/abc123.mp4?signed=1")
    @patch(f"{M}.ffmpeg")
    def test_preserves_extract_to_raw_clips_and_wires_source(self, mock_ffmpeg, mock_presign, mock_upload, isolated_profile_db):
        """The extract is stream-copied from the game video and uploaded to
        raw_clips/{auto_...}, and raw_clips.filename is wired to it so the framing
        resolver finds the surviving source after the game expires."""
        from app.services.auto_export import _export_brilliant_clip

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip_id = self._seed_draft(db, game_id, project_id=100)
        clip = self._make_clip(clip_id=clip_id, auto_project_id=100)

        _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        # Extract still stream-copied from the game video at the clip range.
        mock_presign.assert_called_once_with("games/abc123.mp4")
        call_args = mock_ffmpeg.input.call_args
        assert call_args[0][0] == "https://r2.example.com/games/abc123.mp4?signed=1"
        assert call_args[1]["ss"] == 10.0
        assert call_args[1]["to"] == 15.0

        # Uploaded to the per-clip SOURCE namespace (raw_clips/), NOT final_videos/.
        mock_upload.assert_called_once()
        up_user, up_key, _up_path = mock_upload.call_args[0]
        assert up_user == USER_ID
        assert up_key.startswith("raw_clips/auto_"), up_key

        # raw_clips.filename wired to the same file; no published reel created.
        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        rc = conn.execute("SELECT filename FROM raw_clips WHERE id = ?", (clip_id,)).fetchone()
        conn.close()
        assert rc["filename"] == up_key.split("/", 1)[1]
        assert _count_final_videos(db, game_id) == 0

    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_leaves_frameable_draft_not_published_not_archived(self, mock_ffmpeg, mock_presign, mock_upload, isolated_profile_db):
        """The auto-project stays a non-archived Reel Draft (archived_at NULL,
        no final_video row) with its working_clip intact — never My Reels."""
        from app.services.auto_export import _export_brilliant_clip

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip_id = self._seed_draft(db, game_id, project_id=100)
        clip = self._make_clip(clip_id=clip_id, auto_project_id=100)

        _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        proj = conn.execute("SELECT archived_at, final_video_id FROM projects WHERE id = 100").fetchone()
        wc = conn.execute("SELECT COUNT(*) AS n FROM working_clips WHERE project_id = 100").fetchone()
        conn.close()
        assert proj["archived_at"] is None, "unframed draft must NOT be archived"
        assert proj["final_video_id"] is None, "unframed draft must NOT be published"
        assert wc["n"] >= 1, "draft must keep a frameable working_clip"
        assert _count_final_videos(db, game_id) == 0

    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_rebuilds_working_clip_when_missing(self, mock_ffmpeg, mock_presign, mock_upload, isolated_profile_db):
        """Degenerate case: the auto-project exists but has NO working_clip (e.g.
        v020 archived it). The sweep rebuilds one via the blueprint so the draft
        is renderable."""
        from app.services.auto_export import _export_brilliant_clip

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip_id = self._seed_draft(db, game_id, project_id=100, with_working_clip=False)
        clip = self._make_clip(clip_id=clip_id, auto_project_id=100)

        _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        wc = conn.execute(
            "SELECT raw_clip_id FROM working_clips WHERE project_id = 100"
        ).fetchall()
        conn.close()
        assert len(wc) == 1
        assert wc[0]["raw_clip_id"] == clip_id

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
    def test_timing_logged(self, mock_ffmpeg, mock_presign, mock_upload, isolated_profile_db, caplog):
        """Verify timing info in log for the brilliant clip preservation."""
        import logging

        from app.services.auto_export import _export_brilliant_clip

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip_id = self._seed_draft(db, game_id, project_id=100)
        clip = self._make_clip(clip_id=clip_id, auto_project_id=100)

        with caplog.at_level(logging.INFO, logger="app.services.auto_export"):
            _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        log_text = caplog.text
        assert "Brilliant clip=" in log_text
        assert "ffmpeg stream-copy in" in log_text
        assert "uploaded as" in log_text
        assert "preserved as frameable draft" in log_text

    # --- T4160: already-framed reels are still skipped untouched ---

    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_skips_when_published_reel_exists(self, mock_ffmpeg, mock_presign, mock_upload, isolated_profile_db):
        """T4160: a published final with the same source_clip_id (the user's
        framed, match-played reel — even from a *different* custom project) means
        the highlight is already preserved. The sweep must skip entirely: no
        ffmpeg, no upload, no raw_clips wiring, and the existing row untouched."""
        from app.services.auto_export import _export_brilliant_clip

        db = isolated_profile_db["db_path"]
        game_id = _insert_game(db)
        clip = self._make_clip(clip_id=5, auto_project_id=100)
        # Framed reel lives under a custom project (999), not the auto project (100),
        # proving the guard keys on source_clip_id, not project_id.
        _insert_published_final(db, game_id, project_id=999, source_clip_id=5,
                                filename="framed.mp4", aspect_ratio="9:16")

        _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        mock_presign.assert_not_called()
        mock_ffmpeg.input.assert_not_called()
        mock_upload.assert_not_called()

        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT filename, aspect_ratio FROM final_videos WHERE game_id = ?", (game_id,)
        ).fetchall()
        conn.close()
        assert len(rows) == 1  # framed row still the only row
        assert rows[0]["filename"] == "framed.mp4"
        assert rows[0]["aspect_ratio"] == "9:16"


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

    @patch(f"{M}.upload_bytes_to_r2", return_value=True)
    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_recap_skips_inverted_range_clip(self, mock_ffmpeg, mock_presign, mock_upload, mock_upload_bytes, isolated_profile_db):
        """Bug 23p: a clip with end_time < start_time (inverted range) must be
        skipped so it doesn't fail the whole recap. The valid clips still export."""
        import json

        from app.services.auto_export import _generate_recap

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.filter.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None
        mock_ffmpeg.probe.return_value = {"format": {"duration": "5.0"}}

        clips = [
            {"id": 1, "video_hash": "abc", "start_time": 0.0, "end_time": 5.0,
             "name": "Good", "rating": 5, "tags": None, "notes": None},
            # Inverted range like prod clip 69 (end < start)
            {"id": 69, "video_hash": "abc", "start_time": 3998.0, "end_time": 3959.0,
             "name": "Inverted", "rating": 2, "tags": None, "notes": None},
        ]
        result = _generate_recap(USER_ID, PROFILE_ID, 1, clips)
        assert result == "recaps/1.mp4"

        # The inverted clip is excluded from the recap mapping; only the valid clip remains.
        clip_json = json.loads(mock_upload_bytes.call_args[0][2].decode())
        assert len(clip_json) == 1
        assert clip_json[0]["id"] == 1
        # ffmpeg.input called once per extracted clip (1) + once for concat = 2 (not 3).
        assert mock_ffmpeg.input.call_count == 2

    @patch(f"{M}.upload_bytes_to_r2", return_value=True)
    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_recap_all_clips_invalid_raises(self, mock_ffmpeg, mock_presign, mock_upload, mock_upload_bytes, isolated_profile_db):
        """If every clip has an invalid range, nothing is extracted and recap raises."""
        from app.services.auto_export import _generate_recap

        clips = [
            {"id": 1, "video_hash": "abc", "start_time": 10.0, "end_time": 5.0,
             "name": "Bad1", "rating": 5, "tags": None, "notes": None},
            {"id": 2, "video_hash": "abc", "start_time": 7.0, "end_time": 7.0,
             "name": "Zero", "rating": 4, "tags": None, "notes": None},
        ]
        with pytest.raises(RuntimeError, match="No clips extracted"):
            _generate_recap(USER_ID, PROFILE_ID, 1, clips)

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

    @patch(f"{M}.upload_bytes_to_r2", return_value=True)
    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_recap_encodes_native_resolution_master_quality(
        self, mock_ffmpeg, mock_presign, mock_upload, mock_upload_bytes, isolated_profile_db
    ):
        """T4140: recap segments encode at NATIVE resolution (no 854x480 scale) at
        master-grade quality (crf 18, non-ultrafast preset), still producing the
        recap_start/recap_end mapping."""
        from app.services.auto_export import RECAP_CRF, RECAP_PRESET, _generate_recap

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.filter.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None
        mock_ffmpeg.probe.return_value = {
            "format": {"duration": "5.0"},
            "streams": [{"codec_type": "video", "width": 1920, "height": 1080}],
        }

        _generate_recap(USER_ID, PROFILE_ID, 1, self._make_clips())

        # No 480p downscale filter anywhere (uniform native-res -> no normalization).
        for call in mock_stream.filter.call_args_list:
            assert call.args[:1] != ("scale",) or call.args[1:] != (854, 480), \
                f"unexpected 854x480 scale: {call}"

        # The per-clip extract output uses master-grade params, not ultrafast/crf32.
        extract_kwargs = [
            c.kwargs for c in mock_stream.output.call_args_list
            if c.kwargs.get("vcodec") == "libx264"
        ]
        assert extract_kwargs, "expected a libx264 extract output"
        for kw in extract_kwargs:
            assert kw["crf"] == RECAP_CRF == 18
            assert kw["preset"] == RECAP_PRESET
            assert kw["preset"] != "ultrafast"
            assert kw["movflags"] == "+faststart"

        # Mapping still written with recap offsets.
        clip_json = json.loads(mock_upload_bytes.call_args[0][2].decode())
        assert [(c["id"], c["recap_start"], c["recap_end"]) for c in clip_json] == [
            (1, 0.0, 5.0), (2, 5.0, 10.0),
        ]

    @patch(f"{M}.upload_bytes_to_r2", return_value=True)
    @patch(f"{M}.upload_to_r2", return_value=True)
    @patch(f"{M}.generate_presigned_url_global", return_value="https://r2.example.com/signed")
    @patch(f"{M}.ffmpeg")
    def test_recap_mixed_resolution_normalizes_minority_segment(
        self, mock_ffmpeg, mock_presign, mock_upload, mock_upload_bytes, isolated_profile_db
    ):
        """Mixed-resolution multi-source game: concat c=copy needs a uniform
        resolution, so the minority segment is scaled to the canonical (majority /
        larger) resolution before concat. Two 1080p clips + one 720p clip ->
        the 720p clip is scaled to 1920x1080."""
        from app.services.auto_export import _generate_recap

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.filter.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None
        # Two 1080p sources (majority) then one 720p source.
        mock_ffmpeg.probe.side_effect = [
            {"format": {"duration": "5.0"},
             "streams": [{"codec_type": "video", "width": 1920, "height": 1080}]},
            {"format": {"duration": "5.0"},
             "streams": [{"codec_type": "video", "width": 1920, "height": 1080}]},
            {"format": {"duration": "3.0"},
             "streams": [{"codec_type": "video", "width": 1280, "height": 720}]},
        ]
        clips = [
            {"id": 1, "video_hash": "hash_a", "start_time": 0.0, "end_time": 5.0,
             "name": "A", "rating": 5, "tags": None, "notes": None},
            {"id": 2, "video_hash": "hash_a", "start_time": 6.0, "end_time": 11.0,
             "name": "B", "rating": 5, "tags": None, "notes": None},
            {"id": 3, "video_hash": "hash_b", "start_time": 0.0, "end_time": 3.0,
             "name": "C", "rating": 4, "tags": None, "notes": None},
        ]

        _generate_recap(USER_ID, PROFILE_ID, 1, clips)

        scale_calls = [
            c for c in mock_stream.filter.call_args_list if c.args[:1] == ("scale",)
        ]
        # Exactly one segment normalized (the lone 720p clip), scaled to canonical 1080p.
        assert len(scale_calls) == 1
        assert scale_calls[0].args == ("scale", 1920, 1080)

    @patch(f"{M}.ffmpeg")
    @patch(f"{M}.generate_presigned_url", return_value="RECAP_URL")
    def test_recap_is_legacy_480p_signature(self, mock_presign, mock_ffmpeg, isolated_profile_db):
        """The backfill's idempotency probe: 854x480 -> legacy (upgrade), native ->
        already hi-q, unreadable/missing -> None (skip, never crash)."""
        from app.services.auto_export import _recap_is_legacy_480p

        mock_ffmpeg.probe.return_value = {
            "streams": [{"codec_type": "video", "width": 854, "height": 480}]}
        assert _recap_is_legacy_480p(USER_ID, 1) is True

        mock_ffmpeg.probe.return_value = {
            "streams": [{"codec_type": "video", "width": 1920, "height": 1080}]}
        assert _recap_is_legacy_480p(USER_ID, 1) is False

        mock_ffmpeg.probe.side_effect = Exception("boom")
        assert _recap_is_legacy_480p(USER_ID, 1) is None

    def test_recap_is_legacy_480p_missing_recap_returns_none(self, isolated_profile_db):
        from app.services.auto_export import _recap_is_legacy_480p
        with patch(f"{M}.generate_presigned_url", return_value=None):
            assert _recap_is_legacy_480p(USER_ID, 1) is None


# ---------------------------------------------------------------------------
# backfill_hiq_recaps tests
# ---------------------------------------------------------------------------

class TestBackfillHiqRecaps:
    def _prepare_game(self, db_path, recap_status="complete", recap_url="recaps/1.mp4"):
        game_id = _insert_game(db_path, status=recap_status)
        _insert_clip(db_path, game_id, rating=5)
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            "UPDATE games SET recap_video_url = ? WHERE id = ?", (recap_url, game_id)
        )
        conn.commit()
        conn.close()
        return game_id

    def _run(self, **kwargs):
        from app.services.auto_export import backfill_hiq_recaps
        with patch("app.services.auth_db.get_all_users_for_admin",
                   return_value=[{"user_id": USER_ID}]), \
             patch("app.migrations._get_profile_ids", return_value=[PROFILE_ID]), \
             patch("app.database.ensure_database"):
            return backfill_hiq_recaps(**kwargs)

    @patch(f"{M}._generate_recap", return_value="recaps/1.mp4")
    @patch(f"{M}._recap_is_legacy_480p", return_value=True)
    @patch("app.storage.r2_head_object_global", return_value={"ContentLength": 1})
    def test_upgrades_legacy_recap_when_source_present(
        self, mock_head, mock_legacy, mock_regen, isolated_profile_db
    ):
        game_id = self._prepare_game(isolated_profile_db["db_path"])
        result = self._run()
        assert result["upgraded"] == [game_id]
        assert result["partial"] is False
        mock_regen.assert_called_once()

    @patch(f"{M}._generate_recap")
    @patch("app.storage.r2_head_object_global", return_value=None)
    def test_skips_and_does_not_crash_when_source_gone(
        self, mock_head, mock_regen, isolated_profile_db
    ):
        game_id = self._prepare_game(isolated_profile_db["db_path"])
        result = self._run()
        assert result["skipped_gone"] == [game_id]
        assert result["upgraded"] == []
        mock_regen.assert_not_called()

    @patch(f"{M}._generate_recap")
    @patch(f"{M}._recap_is_legacy_480p", return_value=False)
    @patch("app.storage.r2_head_object_global", return_value={"ContentLength": 1})
    def test_skips_already_hiq_recap(
        self, mock_head, mock_legacy, mock_regen, isolated_profile_db
    ):
        game_id = self._prepare_game(isolated_profile_db["db_path"])
        result = self._run()
        assert result["already_hiq"] == [game_id]
        mock_regen.assert_not_called()

    @patch(f"{M}._generate_recap", return_value="recaps/x.mp4")
    @patch(f"{M}._recap_is_legacy_480p", return_value=True)
    @patch("app.storage.r2_head_object_global", return_value={"ContentLength": 1})
    def test_limit_throttles_and_reports_partial(
        self, mock_head, mock_legacy, mock_regen, isolated_profile_db
    ):
        self._prepare_game(isolated_profile_db["db_path"])
        self._prepare_game(isolated_profile_db["db_path"])
        result = self._run(limit=1)
        assert len(result["upgraded"]) == 1
        assert result["partial"] is True
        assert mock_regen.call_count == 1

    @patch(f"{M}._generate_recap")
    @patch(f"{M}._recap_is_legacy_480p", return_value=True)
    @patch("app.storage.r2_head_object_global", return_value={"ContentLength": 1})
    def test_dry_run_counts_without_regenerating(
        self, mock_head, mock_legacy, mock_regen, isolated_profile_db
    ):
        game_id = self._prepare_game(isolated_profile_db["db_path"])
        result = self._run(dry_run=True)
        assert result["upgraded"] == [game_id]
        assert result["dry_run"] is True
        mock_regen.assert_not_called()


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
