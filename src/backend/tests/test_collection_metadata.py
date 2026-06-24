"""
T3600: Freeze collection metadata (duration, aspect_ratio, tags) at export.

Covers:
- the shared metadata helper (app.services.collection_metadata)
- stamping on all three final_videos insert paths
- the v007 migration (columns, index, backfill from live rows and R2 archives,
  NULL-resilience with visible logging)
- GET /api/downloads exposing the frozen columns
"""

import asyncio
import sqlite3
import pytest
from unittest.mock import patch, MagicMock

from app.utils.encoding import encode_data, decode_data

USER_ID = "test-user-t3600"
PROFILE_ID = "testdefault"


# ---------------------------------------------------------------------------
# Fixtures + seed helpers
# ---------------------------------------------------------------------------

@pytest.fixture()
def full_schema_db(tmp_path):
    """Profile DB created by the real ensure_database() so the canonical
    schema (including the new final_videos columns) is what gets exercised."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield {"db_path": get_database_path(), "tmp_path": tmp_path}


def _connect(db_path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_custom_project(db_path, aspect="9:16", duration=42.5,
                         tags_lists=(["Goal"], ["Goal", "Dribble"])):
    """project + working_video + working_clips -> raw_clips with tags."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES (?, ?)",
                ("My Reel", aspect))
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration) "
        "VALUES (?, 'wv.mp4', 1, ?)",
        (project_id, duration))
    for i, tags in enumerate(tags_lists):
        # Distinct end_time per clip — it's the working-clip identity key in
        # latest_working_clips_subquery
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, tags, start_time, end_time) "
            "VALUES ('c.mp4', 4, ?, ?, ?)",
            (encode_data(tags), i * 10.0, i * 10.0 + 5.0))
        rc_id = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) "
            "VALUES (?, ?, 1, ?)",
            (project_id, rc_id, i))
    conn.commit()
    conn.close()
    return project_id


def _seed_auto_project(db_path, aspect="16:9", start=10.0, end=15.0,
                       tags=("Goal",)):
    """Auto-created project: raw_clip with auto_project_id, no working data."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio, is_auto_created) "
                "VALUES ('Auto', ?, 1)", (aspect,))
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, tags, start_time, end_time, "
        "auto_project_id) VALUES ('c.mp4', 5, ?, ?, ?, ?)",
        (encode_data(list(tags)) if tags else None, start, end, project_id))
    conn.commit()
    conn.close()
    return project_id


def _get_final_video(db_path, fv_id=None):
    conn = _connect(db_path)
    if fv_id is None:
        row = conn.execute(
            "SELECT * FROM final_videos ORDER BY id DESC LIMIT 1").fetchone()
    else:
        row = conn.execute(
            "SELECT * FROM final_videos WHERE id = ?", (fv_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Shared helper: compute_project_metadata
# ---------------------------------------------------------------------------

class TestComputeProjectMetadata:
    def test_custom_project(self, full_schema_db):
        from app.services.collection_metadata import compute_project_metadata

        db = full_schema_db["db_path"]
        project_id = _seed_custom_project(db)

        conn = _connect(db)
        duration, aspect_ratio, tags_blob = compute_project_metadata(
            conn.cursor(), project_id)
        conn.close()

        assert duration == 42.5
        assert aspect_ratio == "9:16"
        assert decode_data(tags_blob) == ["Goal", "Dribble"]  # distinct, ordered

    def test_auto_project_duration_from_raw_clip(self, full_schema_db):
        from app.services.collection_metadata import compute_project_metadata

        db = full_schema_db["db_path"]
        project_id = _seed_auto_project(db, start=10.0, end=15.0, tags=("Goal",))

        conn = _connect(db)
        duration, aspect_ratio, tags_blob = compute_project_metadata(
            conn.cursor(), project_id)
        conn.close()

        assert duration == 5.0
        assert aspect_ratio == "16:9"
        assert decode_data(tags_blob) == ["Goal"]

    def test_no_tags_yields_none(self, full_schema_db):
        from app.services.collection_metadata import compute_project_metadata

        db = full_schema_db["db_path"]
        project_id = _seed_custom_project(db, tags_lists=([],))

        conn = _connect(db)
        duration, aspect_ratio, tags_blob = compute_project_metadata(
            conn.cursor(), project_id)
        conn.close()

        assert tags_blob is None

    def test_missing_project_yields_nulls(self, full_schema_db):
        from app.services.collection_metadata import compute_project_metadata

        db = full_schema_db["db_path"]
        conn = _connect(db)
        duration, aspect_ratio, tags_blob = compute_project_metadata(
            conn.cursor(), 9999)
        conn.close()

        assert duration is None
        assert aspect_ratio is None
        assert tags_blob is None


# ---------------------------------------------------------------------------
# Stamping: _finalize_overlay_export
# ---------------------------------------------------------------------------

class TestOverlayFinalizeStamps:
    def test_stamps_all_three_columns(self, full_schema_db):
        from app.routers.export.overlay import _finalize_overlay_export

        db = full_schema_db["db_path"]
        project_id = _seed_custom_project(db, aspect="9:16", duration=42.5)

        conn = _connect(db)
        conn.execute(
            "INSERT INTO export_jobs (id, project_id, type, input_data) "
            "VALUES ('exp1', ?, 'overlay', x'00')", (project_id,))
        conn.commit()
        conn.close()

        with patch("app.analytics.record_milestone"):
            fv_id = _finalize_overlay_export(project_id, "out.mp4", "exp1", USER_ID)

        fv = _get_final_video(db, fv_id)
        assert fv["duration"] == 42.5
        assert fv["aspect_ratio"] == "9:16"
        assert decode_data(fv["tags"]) == ["Goal", "Dribble"]
        assert fv["source_type"] == "custom_project"


# ---------------------------------------------------------------------------
# Stamping: auto_export _export_brilliant_clip
# ---------------------------------------------------------------------------

class TestAutoExportStamps:
    def _make_clip(self, clip_id, auto_project_id, tags_blob):
        return {
            "id": clip_id,
            "name": "Goal",
            "rating": 5,
            "video_hash": "abc123",
            "start_time": 10.0,
            "end_time": 15.0,
            "auto_project_id": auto_project_id,
            "video_sequence": 1,
            "tags": tags_blob,
            "notes": None,
        }

    @patch("app.services.auto_export.upload_to_r2", return_value=True)
    @patch("app.services.auto_export.generate_presigned_url_global",
           return_value="https://r2.example.com/signed")
    @patch("app.services.auto_export.ffmpeg")
    def test_stamps_aspect_ratio_and_tags(self, mock_ffmpeg, mock_presign,
                                          mock_upload, full_schema_db):
        from app.services.auto_export import _export_brilliant_clip

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None

        db = full_schema_db["db_path"]
        conn = _connect(db)
        cur = conn.cursor()
        cur.execute("INSERT INTO games (name) VALUES ('G1')")
        game_id = cur.lastrowid
        cur.execute("INSERT INTO projects (name, aspect_ratio, is_auto_created) "
                    "VALUES ('Auto', '16:9', 1)")
        project_id = cur.lastrowid
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, tags, start_time, end_time, "
            "game_id, auto_project_id) VALUES ('c.mp4', 5, ?, 10, 15, ?, ?)",
            (encode_data(["Goal", "Assist"]), game_id, project_id))
        conn.commit()
        conn.close()

        clip = self._make_clip(1, project_id, encode_data(["Goal", "Assist"]))
        _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        fv = _get_final_video(db)
        assert fv["duration"] == 5.0
        assert fv["aspect_ratio"] == "16:9"
        assert decode_data(fv["tags"]) == ["Goal", "Assist"]


# ---------------------------------------------------------------------------
# v007 migration
# ---------------------------------------------------------------------------

OLD_SCHEMA = """
    CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        aspect_ratio TEXT NOT NULL,
        working_video_id INTEGER,
        final_video_id INTEGER,
        is_auto_created INTEGER DEFAULT 0,
        archived_at TIMESTAMP DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE raw_clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        rating INTEGER NOT NULL,
        tags BLOB,
        start_time REAL,
        end_time REAL,
        game_id INTEGER,
        auto_project_id INTEGER,
        video_sequence INTEGER
    );
    CREATE TABLE working_clips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        raw_clip_id INTEGER,
        uploaded_filename TEXT,
        sort_order INTEGER DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1
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
        rating_counts TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        watched_at TIMESTAMP,
        published_at TIMESTAMP
    );
"""


@pytest.fixture()
def old_schema_conn(tmp_path):
    """Pre-v007 profile DB (no aspect_ratio/tags on final_videos)."""
    db_path = tmp_path / "old_profile.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.executescript(OLD_SCHEMA)
    conn.commit()
    yield conn
    conn.close()


def _run_v007(conn):
    from app.migrations.profile_db.v007_collection_metadata import (
        V007CollectionMetadata,
    )
    V007CollectionMetadata().up(conn)
    conn.commit()


class TestV007Migration:
    def test_adds_columns_and_index_idempotently(self, old_schema_conn):
        _run_v007(old_schema_conn)
        _run_v007(old_schema_conn)  # second run must not raise

        cols = {r["name"] for r in
                old_schema_conn.execute("PRAGMA table_info(final_videos)")}
        assert "aspect_ratio" in cols
        assert "tags" in cols

        idx = old_schema_conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='index' "
            "AND name='idx_final_videos_published_ratio'").fetchone()
        assert idx is not None

    def test_backfill_from_live_data(self, old_schema_conn):
        conn = old_schema_conn
        conn.execute("INSERT INTO projects (id, name, aspect_ratio) "
                     "VALUES (1, 'P', '9:16')")
        conn.execute("INSERT INTO working_videos (project_id, filename, version, "
                     "duration) VALUES (1, 'wv.mp4', 2, 33.0)")
        conn.execute("INSERT INTO raw_clips (id, filename, rating, tags) "
                     "VALUES (10, 'c.mp4', 4, ?)", (encode_data(["Goal"]),))
        conn.execute("INSERT INTO working_clips (project_id, raw_clip_id, version) "
                     "VALUES (1, 10, 1)")
        conn.execute("INSERT INTO final_videos (id, project_id, filename, "
                     "source_type) VALUES (50, 1, 'f.mp4', 'custom_project')")
        conn.commit()

        with patch("app.services.project_archive.load_archive") as mock_load:
            _run_v007(conn)
            mock_load.assert_not_called()  # live data, no archive read

        row = conn.execute("SELECT * FROM final_videos WHERE id = 50").fetchone()
        assert row["duration"] == 33.0
        assert row["aspect_ratio"] == "9:16"
        assert decode_data(row["tags"]) == ["Goal"]

    def test_backfill_from_archive(self, old_schema_conn):
        conn = old_schema_conn
        # Archived project: row exists, working data deleted by publish
        conn.execute("INSERT INTO projects (id, name, aspect_ratio, archived_at) "
                     "VALUES (2, 'P', '9:16', CURRENT_TIMESTAMP)")
        # raw_clips survive archival
        conn.execute("INSERT INTO raw_clips (id, filename, rating, tags) "
                     "VALUES (20, 'c.mp4', 4, ?)",
                     (encode_data(["Goal", "Save"]),))
        conn.execute("INSERT INTO final_videos (id, project_id, filename, "
                     "source_type, published_at) "
                     "VALUES (60, 2, 'f.mp4', 'custom_project', CURRENT_TIMESTAMP)")
        conn.commit()

        archive = {
            "version": 2,
            "project": {"id": 2, "name": "P", "aspect_ratio": "9:16"},
            "working_clips": [{"id": 1, "project_id": 2, "raw_clip_id": 20,
                               "version": 1}],
            "working_videos": [{"id": 1, "project_id": 2, "version": 1,
                                "duration": 27.5}],
        }
        with patch("app.services.project_archive.load_archive",
                   return_value=archive) as mock_load:
            _run_v007(conn)
            mock_load.assert_called_once()

        row = conn.execute("SELECT * FROM final_videos WHERE id = 60").fetchone()
        assert row["duration"] == 27.5
        assert row["aspect_ratio"] == "9:16"
        assert decode_data(row["tags"]) == ["Goal", "Save"]

    def test_unresolvable_row_stays_null_and_logs(self, old_schema_conn, caplog):
        conn = old_schema_conn
        conn.execute("INSERT INTO final_videos (id, project_id, filename) "
                     "VALUES (70, 999, 'gone.mp4')")
        conn.commit()

        with patch("app.services.project_archive.load_archive",
                   return_value=None):
            with caplog.at_level("WARNING"):
                _run_v007(conn)

        row = conn.execute("SELECT * FROM final_videos WHERE id = 70").fetchone()
        assert row["duration"] is None
        assert row["aspect_ratio"] is None
        assert row["tags"] is None
        assert "[T3600] final_video 70 backfill incomplete" in caplog.text

    def test_backfill_preserves_existing_duration(self, old_schema_conn):
        """Auto exports already stamp duration; backfill must not clobber it."""
        conn = old_schema_conn
        conn.execute("INSERT INTO projects (id, name, aspect_ratio) "
                     "VALUES (3, 'Auto', '16:9')")
        conn.execute("INSERT INTO raw_clips (id, filename, rating, tags, "
                     "start_time, end_time, auto_project_id) "
                     "VALUES (30, 'c.mp4', 5, ?, 0, 7, 3)",
                     (encode_data(["Goal"]),))
        conn.execute("INSERT INTO final_videos (id, project_id, filename, "
                     "source_type, duration) "
                     "VALUES (80, 3, 'f.mp4', 'brilliant_clip', 7.0)")
        conn.commit()

        _run_v007(conn)

        row = conn.execute("SELECT * FROM final_videos WHERE id = 80").fetchone()
        assert row["duration"] == 7.0
        assert row["aspect_ratio"] == "16:9"
        assert decode_data(row["tags"]) == ["Goal"]

    def test_backfill_annotated_game_rows(self, old_schema_conn):
        """Legacy annotated_game rows (project_id NULL, game_id set) get
        duration/tags from rated raw_clips; aspect_ratio stays NULL."""
        conn = old_schema_conn
        conn.execute("INSERT INTO raw_clips (filename, rating, tags, "
                     "start_time, end_time, game_id) "
                     "VALUES ('c1.mp4', 5, ?, 0, 10, 7)",
                     (encode_data(["Goal"]),))
        conn.execute("INSERT INTO raw_clips (filename, rating, tags, "
                     "start_time, end_time, game_id) "
                     "VALUES ('c2.mp4', 3, ?, 10, 14, 7)",
                     (encode_data(["Save"]),))
        # Rating < 3 is excluded from the annotated-game definition
        conn.execute("INSERT INTO raw_clips (filename, rating, tags, "
                     "start_time, end_time, game_id) "
                     "VALUES ('c3.mp4', 1, ?, 14, 20, 7)",
                     (encode_data(["Blunder"]),))
        conn.execute("INSERT INTO final_videos (id, project_id, game_id, "
                     "filename, source_type) "
                     "VALUES (95, NULL, 7, 'a.mp4', 'annotated_game')")
        conn.commit()

        _run_v007(conn)

        row = conn.execute("SELECT * FROM final_videos WHERE id = 95").fetchone()
        assert row["duration"] == 14.0
        assert row["aspect_ratio"] is None
        assert decode_data(row["tags"]) == ["Goal", "Save"]

    def test_bad_row_does_not_abort_migration(self, old_schema_conn):
        """Per-row isolation: one corrupt row must not block the others."""
        conn = old_schema_conn
        conn.execute("INSERT INTO projects (id, name, aspect_ratio) "
                     "VALUES (4, 'P', '9:16')")
        conn.execute("INSERT INTO working_videos (project_id, filename, version, "
                     "duration) VALUES (4, 'wv.mp4', 1, 12.0)")
        # Corrupt tags blob on the clip feeding row 91
        conn.execute("INSERT INTO raw_clips (id, filename, rating, tags) "
                     "VALUES (40, 'c.mp4', 4, x'c1')")  # invalid msgpack
        conn.execute("INSERT INTO working_clips (project_id, raw_clip_id, version) "
                     "VALUES (4, 40, 1)")
        conn.execute("INSERT INTO final_videos (id, project_id, filename) "
                     "VALUES (91, 4, 'f.mp4')")
        # Healthy sibling row
        conn.execute("INSERT INTO projects (id, name, aspect_ratio) "
                     "VALUES (5, 'P2', '16:9')")
        conn.execute("INSERT INTO working_videos (project_id, filename, version, "
                     "duration) VALUES (5, 'wv2.mp4', 1, 9.0)")
        conn.execute("INSERT INTO final_videos (id, project_id, filename) "
                     "VALUES (92, 5, 'f2.mp4')")
        conn.commit()

        _run_v007(conn)  # must not raise

        healthy = conn.execute(
            "SELECT * FROM final_videos WHERE id = 92").fetchone()
        assert healthy["duration"] == 9.0
        assert healthy["aspect_ratio"] == "16:9"


# ---------------------------------------------------------------------------
# GET /api/downloads exposes the frozen columns
# ---------------------------------------------------------------------------

class TestDownloadsResponse:
    def test_returns_frozen_fields(self, full_schema_db):
        from app.routers.downloads import list_downloads

        db = full_schema_db["db_path"]
        project_id = _seed_custom_project(db, aspect="9:16", duration=42.5)
        conn = _connect(db)
        conn.execute(
            "INSERT INTO final_videos (project_id, filename, version, source_type, "
            "name, duration, aspect_ratio, tags, published_at) "
            "VALUES (?, 'f.mp4', 1, 'custom_project', 'My Reel', 42.5, '9:16', ?, "
            "CURRENT_TIMESTAMP)",
            (project_id, encode_data(["Goal", "Dribble"])))
        conn.commit()
        conn.close()

        response = asyncio.run(list_downloads(None))

        assert response.total_count == 1
        item = response.downloads[0]
        assert item.duration == 42.5
        assert item.aspect_ratio == "9:16"
        assert item.tags == ["Goal", "Dribble"]

    def test_null_metadata_row_still_renders(self, full_schema_db):
        """Un-backfilled rows render with NULL metadata (no silent fallback)."""
        from app.routers.downloads import list_downloads

        db = full_schema_db["db_path"]
        conn = _connect(db)
        conn.execute(
            "INSERT INTO final_videos (project_id, filename, version, source_type, "
            "name, published_at) "
            "VALUES (NULL, 'old.mp4', 1, 'custom_project', 'Old Reel', "
            "CURRENT_TIMESTAMP)")
        conn.commit()
        conn.close()

        response = asyncio.run(list_downloads(None))

        assert response.total_count == 1
        item = response.downloads[0]
        assert item.duration is None
        assert item.aspect_ratio is None
        assert item.tags == []


# ---------------------------------------------------------------------------
# T3920: unified two-half in-match start (clip_game_start_time)
# ---------------------------------------------------------------------------

def _seed_two_half_game(db_path, first_half_duration=2715.0,
                        second_half_duration=2700.0):
    """A game with two half-videos. Returns game_id."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO games (name) VALUES ('TwoHalf')")
    game_id = cur.lastrowid
    cur.execute(
        "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) "
        "VALUES (?, 'h1', 1, ?)", (game_id, first_half_duration))
    cur.execute(
        "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) "
        "VALUES (?, 'h2', 2, ?)", (game_id, second_half_duration))
    conn.commit()
    conn.close()
    return game_id


def _seed_raw_clip(db_path, game_id, video_sequence, start_time):
    """A raw clip in a given half. Returns raw_clip id."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, "
        "game_id, video_sequence) VALUES ('c.mp4', 5, ?, ?, ?, ?)",
        (start_time, start_time + 5.0, game_id, video_sequence))
    rc_id = cur.lastrowid
    conn.commit()
    conn.close()
    return rc_id


class TestComputeUnifiedClipStart:
    def test_first_half_unchanged(self, full_schema_db):
        from app.services.collection_metadata import compute_unified_clip_start
        db = full_schema_db["db_path"]
        game_id = _seed_two_half_game(db)
        rc = _seed_raw_clip(db, game_id, video_sequence=1, start_time=120.0)

        conn = _connect(db)
        result = compute_unified_clip_start(conn.cursor(), rc, 120.0)
        conn.close()
        assert result == 120.0

    def test_second_half_adds_first_half_duration(self, full_schema_db):
        from app.services.collection_metadata import compute_unified_clip_start
        db = full_schema_db["db_path"]
        game_id = _seed_two_half_game(db, first_half_duration=2715.0)
        # 5 min (300s) into the 2nd half -> 2715 + 300 = 3015 (game minute ~50')
        rc = _seed_raw_clip(db, game_id, video_sequence=2, start_time=300.0)

        conn = _connect(db)
        result = compute_unified_clip_start(conn.cursor(), rc, 300.0)
        conn.close()
        assert result == 3015.0

    def test_null_start_returns_none(self, full_schema_db):
        from app.services.collection_metadata import compute_unified_clip_start
        db = full_schema_db["db_path"]
        conn = _connect(db)
        assert compute_unified_clip_start(conn.cursor(), 1, None) is None
        conn.close()

    def test_null_source_clip_returns_start_unchanged(self, full_schema_db):
        from app.services.collection_metadata import compute_unified_clip_start
        db = full_schema_db["db_path"]
        conn = _connect(db)
        assert compute_unified_clip_start(conn.cursor(), None, 42.0) == 42.0
        conn.close()

    def test_missing_clip_falls_back_to_file_relative(self, full_schema_db):
        """Source clip deleted -> best-effort file-relative, never invented."""
        from app.services.collection_metadata import compute_unified_clip_start
        db = full_schema_db["db_path"]
        conn = _connect(db)
        result = compute_unified_clip_start(conn.cursor(), 99999, 300.0)
        conn.close()
        assert result == 300.0

    def test_second_half_without_durations_falls_back(self, full_schema_db):
        """video_sequence=2 but no game_videos -> offset 0 (file-relative)."""
        from app.services.collection_metadata import compute_unified_clip_start
        db = full_schema_db["db_path"]
        conn = _connect(db)
        cur = conn.cursor()
        cur.execute("INSERT INTO games (name) VALUES ('NoVids')")
        game_id = cur.lastrowid
        conn.commit()
        conn.close()
        rc = _seed_raw_clip(db, game_id, video_sequence=2, start_time=300.0)

        conn = _connect(db)
        result = compute_unified_clip_start(conn.cursor(), rc, 300.0)
        conn.close()
        assert result == 300.0


class TestExportStampsGameStart:
    @patch("app.services.auto_export.upload_to_r2", return_value=True)
    @patch("app.services.auto_export.generate_presigned_url_global",
           return_value="https://r2.example.com/signed")
    @patch("app.services.auto_export.ffmpeg")
    def test_brilliant_clip_freezes_unified_game_start(
            self, mock_ffmpeg, mock_presign, mock_upload, full_schema_db):
        from app.services.auto_export import _export_brilliant_clip

        mock_stream = MagicMock()
        mock_ffmpeg.input.return_value = mock_stream
        mock_stream.output.return_value = mock_stream
        mock_stream.run.return_value = None

        db = full_schema_db["db_path"]
        game_id = _seed_two_half_game(db, first_half_duration=2715.0)
        conn = _connect(db)
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (name, aspect_ratio, is_auto_created) "
                    "VALUES ('Auto', '16:9', 1)")
        project_id = cur.lastrowid
        # 2nd-half brilliant clip 300s in
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, tags, start_time, end_time, "
            "game_id, video_sequence, auto_project_id) "
            "VALUES ('c.mp4', 5, ?, 300, 305, ?, 2, ?)",
            (encode_data(["Goal"]), game_id, project_id))
        rc_id = cur.lastrowid
        conn.commit()
        conn.close()

        clip = {
            "id": rc_id, "name": "Goal", "rating": 5, "video_hash": "abc",
            "start_time": 300.0, "end_time": 305.0,
            "auto_project_id": project_id, "video_sequence": 2,
            "tags": encode_data(["Goal"]), "notes": None,
        }
        _export_brilliant_clip(USER_ID, PROFILE_ID, clip, game_id)

        fv = _get_final_video(db)
        assert fv["clip_start_time"] == 300.0       # file-relative, frozen
        assert fv["clip_game_start_time"] == 3015.0  # unified (2715 + 300)


@pytest.fixture()
def pre_v016_conn(tmp_path):
    """Profile DB with final_videos carrying source_clip_id + clip_start_time
    (v010) but NOT clip_game_start_time, plus raw_clips + game_videos."""
    db_path = tmp_path / "pre_v016.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL, rating INTEGER NOT NULL,
            start_time REAL, end_time REAL, game_id INTEGER, video_sequence INTEGER
        );
        CREATE TABLE game_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL, sequence INTEGER NOT NULL, duration REAL
        );
        CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER, filename TEXT NOT NULL,
            clip_count INTEGER, source_clip_id INTEGER, clip_start_time REAL
        );
    """)
    conn.commit()
    yield conn
    conn.close()


def _run_v016(conn):
    from app.migrations.profile_db.v016_clip_game_start_time import (
        V016ClipGameStartTime,
    )
    V016ClipGameStartTime().up(conn)
    conn.commit()


class TestV016Migration:
    def test_adds_column_idempotently(self, pre_v016_conn):
        _run_v016(pre_v016_conn)
        _run_v016(pre_v016_conn)  # second run must not raise
        cols = {r[1] for r in
                pre_v016_conn.execute("PRAGMA table_info(final_videos)")}
        assert "clip_game_start_time" in cols

    def test_backfills_second_half_offset(self, pre_v016_conn):
        conn = pre_v016_conn
        conn.execute("INSERT INTO game_videos (game_id, sequence, duration) "
                     "VALUES (7, 1, 2715)")
        conn.execute("INSERT INTO game_videos (game_id, sequence, duration) "
                     "VALUES (7, 2, 2700)")
        conn.execute("INSERT INTO raw_clips (id, filename, rating, start_time, "
                     "end_time, game_id, video_sequence) "
                     "VALUES (10, 'c.mp4', 5, 300, 305, 7, 2)")
        conn.execute("INSERT INTO final_videos (id, project_id, filename, "
                     "clip_count, source_clip_id, clip_start_time) "
                     "VALUES (50, 1, 'f.mp4', 1, 10, 300)")
        conn.commit()

        _run_v016(conn)

        row = conn.execute("SELECT * FROM final_videos WHERE id = 50").fetchone()
        assert row["clip_game_start_time"] == 3015.0

    def test_first_half_backfill_equals_file_relative(self, pre_v016_conn):
        conn = pre_v016_conn
        conn.execute("INSERT INTO game_videos (game_id, sequence, duration) "
                     "VALUES (8, 1, 2715)")
        conn.execute("INSERT INTO raw_clips (id, filename, rating, start_time, "
                     "end_time, game_id, video_sequence) "
                     "VALUES (11, 'c.mp4', 5, 120, 125, 8, 1)")
        conn.execute("INSERT INTO final_videos (id, project_id, filename, "
                     "clip_count, source_clip_id, clip_start_time) "
                     "VALUES (51, 1, 'f.mp4', 1, 11, 120)")
        conn.commit()

        _run_v016(conn)

        row = conn.execute("SELECT * FROM final_videos WHERE id = 51").fetchone()
        assert row["clip_game_start_time"] == 120.0

    def test_multiclip_reel_stays_null(self, pre_v016_conn):
        conn = pre_v016_conn
        conn.execute("INSERT INTO final_videos (id, project_id, filename, "
                     "clip_count, source_clip_id, clip_start_time) "
                     "VALUES (52, 1, 'mix.mp4', 3, NULL, NULL)")
        conn.commit()

        _run_v016(conn)

        row = conn.execute("SELECT * FROM final_videos WHERE id = 52").fetchone()
        assert row["clip_game_start_time"] is None

    def test_bad_row_does_not_abort_migration(self, pre_v016_conn):
        """Per-row isolation: source clip missing -> file-relative fallback,
        sibling rows still processed."""
        conn = pre_v016_conn
        # Row whose source clip is gone -> falls back to file-relative
        conn.execute("INSERT INTO final_videos (id, project_id, filename, "
                     "clip_count, source_clip_id, clip_start_time) "
                     "VALUES (60, 1, 'gone.mp4', 1, 9999, 90)")
        # Healthy sibling
        conn.execute("INSERT INTO game_videos (game_id, sequence, duration) "
                     "VALUES (9, 1, 2700)")
        conn.execute("INSERT INTO raw_clips (id, filename, rating, start_time, "
                     "end_time, game_id, video_sequence) "
                     "VALUES (12, 'c.mp4', 5, 60, 65, 9, 2)")
        conn.execute("INSERT INTO final_videos (id, project_id, filename, "
                     "clip_count, source_clip_id, clip_start_time) "
                     "VALUES (61, 1, 'f.mp4', 1, 12, 60)")
        conn.commit()

        _run_v016(conn)  # must not raise

        gone = conn.execute("SELECT * FROM final_videos WHERE id = 60").fetchone()
        assert gone["clip_game_start_time"] == 90.0  # file-relative fallback
        healthy = conn.execute(
            "SELECT * FROM final_videos WHERE id = 61").fetchone()
        assert healthy["clip_game_start_time"] == 2760.0  # 2700 + 60


class TestDownloadsExposesGameStart:
    def test_returns_clip_game_start_time(self, full_schema_db):
        from app.routers.downloads import list_downloads

        db = full_schema_db["db_path"]
        conn = _connect(db)
        conn.execute(
            "INSERT INTO final_videos (project_id, filename, version, source_type, "
            "name, clip_count, clip_start_time, clip_game_start_time, published_at) "
            "VALUES (NULL, 'f.mp4', 1, 'brilliant_clip', 'Goal', 1, 300, 3015, "
            "CURRENT_TIMESTAMP)")
        conn.commit()
        conn.close()

        response = asyncio.run(list_downloads(None))

        assert response.total_count == 1
        assert response.downloads[0].clip_game_start_time == 3015.0

    def test_multiclip_reel_exposes_null(self, full_schema_db):
        from app.routers.downloads import list_downloads

        db = full_schema_db["db_path"]
        conn = _connect(db)
        conn.execute(
            "INSERT INTO final_videos (project_id, filename, version, source_type, "
            "name, clip_count, clip_start_time, clip_game_start_time, published_at) "
            "VALUES (NULL, 'mix.mp4', 1, 'custom_project', 'Mix', 3, NULL, NULL, "
            "CURRENT_TIMESTAMP)")
        conn.commit()
        conn.close()

        response = asyncio.run(list_downloads(None))

        assert response.total_count == 1
        assert response.downloads[0].clip_game_start_time is None


# ---------------------------------------------------------------------------
# T3920: GET /api/projects exposes clip_game_start_time for single-clip drafts
# (read-time computed -- drafts have no frozen final_video yet)
# ---------------------------------------------------------------------------

def _seed_auto_draft(db_path, game_id, video_sequence, start_time, name="Draft"):
    """An auto-created single-clip draft: project + raw_clip(auto_project_id)."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio, is_auto_created) "
                "VALUES (?, '9:16', 1)", (name,))
    pid = cur.lastrowid
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id, "
        "video_sequence, auto_project_id) VALUES ('c.mp4', 5, ?, ?, ?, ?, ?)",
        (start_time, start_time + 5.0, game_id, video_sequence, pid))
    conn.commit()
    conn.close()
    return pid


class TestProjectsExposeGameStart:
    def test_second_half_draft_gets_offset(self, full_schema_db):
        from app.routers.projects import list_projects
        db = full_schema_db["db_path"]
        game_id = _seed_two_half_game(db, first_half_duration=2715.0)
        pid = _seed_auto_draft(db, game_id, video_sequence=2, start_time=300.0)

        items = asyncio.run(list_projects())
        p = next(p for p in items if p.id == pid)
        # Fresh auto-drafts have no working_clips (clip_count counts those), but
        # carry exactly one source raw_clip -> game time still resolves.
        assert p.clip_game_start_time == 3015.0  # 2715 + 300

    def test_first_half_draft_equals_file_relative(self, full_schema_db):
        from app.routers.projects import list_projects
        db = full_schema_db["db_path"]
        game_id = _seed_two_half_game(db)
        pid = _seed_auto_draft(db, game_id, video_sequence=1, start_time=120.0)

        items = asyncio.run(list_projects())
        p = next(p for p in items if p.id == pid)
        assert p.clip_game_start_time == 120.0

    def test_multiclip_draft_has_no_game_time(self, full_schema_db):
        from app.routers.projects import list_projects
        db = full_schema_db["db_path"]
        # _seed_custom_project seeds a 2-clip working-clip project
        pid = _seed_custom_project(db)

        items = asyncio.run(list_projects())
        p = next(p for p in items if p.id == pid)
        assert p.clip_count == 2
        assert p.clip_game_start_time is None
