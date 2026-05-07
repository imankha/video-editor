"""
T1500: Persist clip dimensions (width/height/fps) on working_clips.

Verifies:
  - Schema migration adds width/height/fps to working_clips (nullable).
  - Schema migration adds fps to game_videos and video_fps to games.
  - WorkingClipResponse includes width/height/fps fields.
  - INSERT at clips.py:646/1189 copies dims from game_videos via raw_clip.video_sequence.
  - INSERT at clips.py:1205 (upload path) probes via ffprobe.

Run with: pytest src/backend/tests/test_t1500_clip_dimensions.py -v
"""

import pytest
import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_t1500_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "ab12cd34"


def setup_module():
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.user_context import reset_user_id
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from app.database import get_db_connection


def _column_names(cursor, table: str) -> list[str]:
    cursor.execute(f"PRAGMA table_info({table})")
    return [row['name'] for row in cursor.fetchall()]


# ---------- Schema tests ----------

def test_working_clips_has_width_height_fps():
    """working_clips should have width INTEGER, height INTEGER, fps REAL columns."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cols = _column_names(cursor, "working_clips")
        assert "width" in cols, f"working_clips missing 'width' column. Have: {cols}"
        assert "height" in cols, f"working_clips missing 'height' column. Have: {cols}"
        assert "fps" in cols, f"working_clips missing 'fps' column. Have: {cols}"


def test_working_clips_dims_are_nullable():
    """New dim columns must be nullable so backfill can run retroactively."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(working_clips)")
        rows = {r['name']: r for r in cursor.fetchall()}
        for col in ("width", "height", "fps"):
            assert rows[col]['notnull'] == 0, f"{col} should be nullable"


def test_game_videos_has_fps():
    """game_videos should have fps REAL column (source of truth)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cols = _column_names(cursor, "game_videos")
        assert "fps" in cols, f"game_videos missing 'fps' column. Have: {cols}"


def test_games_has_video_fps():
    """games should have video_fps REAL column (legacy single-video path)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cols = _column_names(cursor, "games")
        assert "video_fps" in cols, f"games missing 'video_fps' column. Have: {cols}"


# ---------- API response tests ----------

def test_working_clip_response_has_dim_fields():
    """WorkingClipResponse pydantic model must include width/height/fps."""
    from app.routers.clips import WorkingClipResponse
    fields = WorkingClipResponse.model_fields
    assert "width" in fields, "WorkingClipResponse missing width field"
    assert "height" in fields, "WorkingClipResponse missing height field"
    assert "fps" in fields, "WorkingClipResponse missing fps field"


def test_working_clip_response_dims_optional():
    """Dim fields must be Optional (nullable) to match schema."""
    from app.routers.clips import WorkingClipResponse
    # Should construct with None for the new fields
    resp = WorkingClipResponse(
        id=1, project_id=1, raw_clip_id=None, uploaded_filename="x.mp4",
        sort_order=0, width=None, height=None, fps=None,
    )
    assert resp.width is None
    assert resp.height is None
    assert resp.fps is None


# ---------- INSERT population tests ----------

def _insert_game_with_video(cursor, game_id: int, sequence: int,
                             width: int, height: int, fps: float) -> None:
    cursor.execute(
        "INSERT INTO games (id, name, video_filename, video_width, video_height, video_fps) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (game_id, f"test game {game_id}", f"g{game_id}.mp4", width, height, fps),
    )
    cursor.execute(
        "INSERT INTO game_videos (game_id, blake3_hash, sequence, video_width, video_height, fps) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (game_id, f"hash{game_id}_{sequence}", sequence, width, height, fps),
    )


def test_library_add_copies_dims_from_game_video():
    """
    clips.py:1189 — adding a raw_clip (library clip) to a project should
    copy width/height/fps from the raw_clip's parent game_video.
    """
    from app.routers.clips import _insert_working_clip_with_dims  # helper we'll introduce

    with get_db_connection() as conn:
        cursor = conn.cursor()
        _insert_game_with_video(cursor, game_id=9001, sequence=1,
                                 width=1920, height=1080, fps=29.97)
        cursor.execute(
            "INSERT INTO raw_clips (id, filename, rating, game_id, video_sequence, start_time, end_time) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (9001, "hash9001_1.mp4", 5, 9001, 1, 0.0, 5.0),
        )
        cursor.execute(
            "INSERT INTO projects (id, name, aspect_ratio) VALUES (?, ?, ?)",
            (9001, "T1500 test project", "16:9"),
        )

        wc_id = _insert_working_clip_with_dims(
            cursor, project_id=9001, raw_clip_id=9001, sort_order=0
        )
        conn.commit()

        cursor.execute(
            "SELECT width, height, fps FROM working_clips WHERE id = ?", (wc_id,)
        )
        row = cursor.fetchone()
        assert row['width'] == 1920
        assert row['height'] == 1080
        assert row['fps'] == pytest.approx(29.97)


def test_game_video_insert_probes_fps_from_r2(monkeypatch):
    """
    T1500 follow-up: inserting a game_video triggers a server-side byte-range
    ffprobe that populates fps. Width/height still come from the client.
    """
    from app.routers import games as games_module

    def fake_probe(blake3_hash: str):
        if blake3_hash == "hash9003":
            return {"fps": 29.97, "duration": 10.0, "width": 1920, "height": 1080}
        return None

    monkeypatch.setattr(games_module, "_probe_video_metadata", fake_probe)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (id, name, video_filename) VALUES (?, ?, ?)",
            (9003, "test game 9003", "g9003.mp4"),
        )
        video = games_module.VideoReference(
            blake3_hash="HASH9003",
            sequence=1,
            duration=10.0,
            width=1920,
            height=1080,
            file_size=12345,
        )
        games_module._insert_game_videos(cursor, 9003, [video])
        conn.commit()

        cursor.execute(
            "SELECT video_width, video_height, fps FROM game_videos WHERE game_id = ?",
            (9003,),
        )
        row = cursor.fetchone()
        assert row['video_width'] == 1920
        assert row['video_height'] == 1080
        assert row['fps'] == pytest.approx(29.97)


def test_library_add_leaves_nulls_when_game_video_missing_dims():
    """
    When parent game_video has NULL dims (legacy row, pre-backfill), working_clips
    should get NULL dims — probe fallback on the frontend handles these.
    """
    from app.routers.clips import _insert_working_clip_with_dims

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (id, name, video_filename) VALUES (?, ?, ?)",
            (9002, "test game 9002", "g9002.mp4"),
        )
        cursor.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (?, ?, ?)",
            (9002, "hash9002_1", 1),
        )
        cursor.execute(
            "INSERT INTO raw_clips (id, filename, rating, game_id, video_sequence, end_time) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (9002, "hash9002_1.mp4", 3, 9002, 1, 5.0),
        )
        cursor.execute(
            "INSERT INTO projects (id, name, aspect_ratio) VALUES (?, ?, ?)",
            (9002, "T1500 null test", "16:9"),
        )

        wc_id = _insert_working_clip_with_dims(
            cursor, project_id=9002, raw_clip_id=9002, sort_order=0
        )
        conn.commit()

        cursor.execute(
            "SELECT width, height, fps FROM working_clips WHERE id = ?", (wc_id,)
        )
        row = cursor.fetchone()
        assert row['width'] is None
        assert row['height'] is None
        assert row['fps'] is None


def test_activate_backfills_all_metadata(monkeypatch):
    """
    When a pending game is activated, the probe should backfill ALL missing
    metadata (duration, width, height, fps) on both game_videos and games tables.
    """
    from app.routers import games as games_module
    from app.constants import GameStatus

    def fake_probe(blake3_hash: str):
        if blake3_hash == "hash9004":
            return {"fps": 29.97, "duration": 120.5, "width": 1920, "height": 1080}
        return None

    def fake_validate(blake3_hash: str):
        pass

    def fake_deduct(user_id, cost, source=None, reference_id=None):
        return {"success": True, "balance": 100}

    def fake_upload_cost(size):
        return 1

    def fake_expires():
        from datetime import datetime
        return datetime(2026, 12, 31)

    def fake_insert_ref(*args, **kwargs):
        pass

    monkeypatch.setattr(games_module, "_probe_video_metadata", fake_probe)
    monkeypatch.setattr(games_module, "_validate_video_in_r2", fake_validate)
    monkeypatch.setattr(games_module, "deduct_credits", fake_deduct)
    monkeypatch.setattr(games_module, "calculate_upload_cost", fake_upload_cost)
    monkeypatch.setattr(games_module, "storage_expires_at", fake_expires)
    monkeypatch.setattr(games_module, "insert_game_storage_ref", fake_insert_ref)

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (id, name, blake3_hash, video_filename, video_size, status) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (9004, "test pending game", "hash9004", "hash9004.mp4", 5000000, GameStatus.PENDING),
        )
        cursor.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence, video_size) "
            "VALUES (?, ?, ?, ?)",
            (9004, "hash9004", 1, 5000000),
        )
        conn.commit()

        # Verify metadata is NULL before activation
        cursor.execute("SELECT duration, video_width, video_height, fps FROM game_videos WHERE game_id = ?", (9004,))
        row = cursor.fetchone()
        assert row['duration'] is None
        assert row['video_width'] is None
        assert row['video_height'] is None
        assert row['fps'] is None

    import asyncio
    asyncio.run(games_module.activate_game(9004))

    with get_db_connection() as conn:
        cursor = conn.cursor()

        # game_videos should be backfilled
        cursor.execute("SELECT duration, video_width, video_height, fps FROM game_videos WHERE game_id = ?", (9004,))
        gv = cursor.fetchone()
        assert gv['duration'] == pytest.approx(120.5)
        assert gv['video_width'] == 1920
        assert gv['video_height'] == 1080
        assert gv['fps'] == pytest.approx(29.97)

        # games table should also be backfilled
        cursor.execute("SELECT video_duration, video_width, video_height, video_fps FROM games WHERE id = ?", (9004,))
        g = cursor.fetchone()
        assert g['video_duration'] == pytest.approx(120.5)
        assert g['video_width'] == 1920
        assert g['video_height'] == 1080
        assert g['video_fps'] == pytest.approx(29.97)
