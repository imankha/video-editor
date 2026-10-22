"""
T13280 — persisted source preference: game_videos.preferred (profile_db v058),
written only through PATCH /api/games/{game_id}/videos/{sequence}/placement.

The user's requirement (2026-10-22): "once I switch the source for a particular
range, that value needs to stick ... it needs to persist and be consistent with
our sync strategy." So the flag lives in the per-profile SQLite next to
offset_seconds and rides the same durable_sync write path.

Covers:
  - the v058 migration adds the column (default 0) and is idempotent
  - /load projects `preferred` (False by default)
  - preferred alone is a valid write; offset_seconds is untouched by it
  - offset + preferred in ONE write (a drop that creates overlap)
  - an offset-only write leaves preferred as it was
  - an empty body is rejected (422): a no-op can never pass as a save
"""

import shutil
import sqlite3
import tempfile
import uuid
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id


def _seed_overlap_game():
    from app.database import USER_DATA_BASE, ensure_database, get_db_connection

    user_id = f"test_t13280_{uuid.uuid4().hex[:8]}"
    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    ensure_database()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO games (name) VALUES ('Overlap')")
        game_id = cur.lastrowid
        cur.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration, offset_seconds) "
            "VALUES (?, 'h1', 1, 600.0, 0.0)",
            (game_id,),
        )
        cur.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration, offset_seconds) "
            "VALUES (?, 'h2', 2, 300.0, 100.0)",
            (game_id,),
        )
        conn.commit()
    return user_id, game_id, USER_DATA_BASE / user_id


@pytest.fixture
def overlap_game(monkeypatch):
    import app.routers.games as games_mod

    monkeypatch.setattr(games_mod, "generate_presigned_url_global", lambda *a, **k: "https://x/v.mp4")
    user_id, game_id, user_dir = _seed_overlap_game()
    try:
        yield game_id
    finally:
        if user_dir.exists():
            shutil.rmtree(user_dir, ignore_errors=True)


def test_v058_adds_preferred_default_0_and_is_idempotent():
    from app.migrations.profile_db.v058_game_videos_preferred import V058GameVideosPreferred

    with tempfile.TemporaryDirectory() as d:
        db = Path(d) / "profile.sqlite"
        conn = sqlite3.connect(str(db))
        conn.execute(
            "CREATE TABLE game_videos (id INTEGER PRIMARY KEY, game_id INTEGER, blake3_hash TEXT, "
            "sequence INTEGER, duration REAL, offset_seconds REAL, original_filename TEXT)"
        )
        conn.execute("INSERT INTO game_videos (game_id, blake3_hash, sequence, duration) VALUES (1, 'h', 1, 10.0)")
        conn.commit()
        m = V058GameVideosPreferred()
        m.up(conn)
        m.up(conn)  # idempotent: second run is a no-op, not an error
        cols = {r[1] for r in conn.execute("PRAGMA table_info(game_videos)").fetchall()}
        assert "preferred" in cols
        assert conn.execute("SELECT preferred FROM game_videos").fetchone()[0] == 0
        conn.close()


@pytest.mark.asyncio
async def test_load_projects_preferred_false_by_default(overlap_game):
    from app.database import get_db_connection
    from app.routers.games import _get_game_videos_response

    with get_db_connection() as conn:
        videos = _get_game_videos_response(conn.cursor(), overlap_game)
    assert [v["preferred"] for v in videos] == [False, False]


@pytest.mark.asyncio
async def test_preferred_alone_writes_flag_and_leaves_offset(overlap_game):
    from app.database import get_db_connection
    from app.routers.games import PlacementUpdate, update_video_placement

    resp = await update_video_placement(overlap_game, 2, PlacementUpdate(preferred=True))
    assert resp["sequence"] == 2
    assert resp["preferred"] is True
    assert resp["offset_seconds"] == pytest.approx(100.0)
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT preferred, offset_seconds FROM game_videos WHERE game_id = ? AND sequence = 2",
            (overlap_game,),
        ).fetchone()
    assert row["preferred"] == 1
    assert row["offset_seconds"] == pytest.approx(100.0)

    # And back off again (picking the main camera inside the span).
    resp = await update_video_placement(overlap_game, 2, PlacementUpdate(preferred=False))
    assert resp["preferred"] is False


@pytest.mark.asyncio
async def test_drop_writes_offset_and_preferred_together(overlap_game):
    from app.routers.games import PlacementUpdate, update_video_placement

    resp = await update_video_placement(
        overlap_game, 2, PlacementUpdate(offset_seconds=142.5, preferred=True)
    )
    assert resp["offset_seconds"] == pytest.approx(142.5)
    assert resp["preferred"] is True


@pytest.mark.asyncio
async def test_offset_only_write_leaves_preferred_untouched(overlap_game):
    from app.routers.games import PlacementUpdate, update_video_placement

    await update_video_placement(overlap_game, 2, PlacementUpdate(preferred=True))
    resp = await update_video_placement(overlap_game, 2, PlacementUpdate(offset_seconds=120.0))
    assert resp["offset_seconds"] == pytest.approx(120.0)
    assert resp["preferred"] is True


def test_empty_body_rejected():
    from app.routers.games import PlacementUpdate

    with pytest.raises(ValidationError):
        PlacementUpdate()
