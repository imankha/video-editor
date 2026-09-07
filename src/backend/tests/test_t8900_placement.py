"""
T8900 — Fix-timing placement endpoint:
PATCH /api/games/{game_id}/videos/{sequence}/placement body {offset_seconds}.

Covers the curated set named in the task classification:
  - happy path: writes offset_seconds ONLY (never recorded_at), returns the row
  - 404 on an unknown sequence (and unknown game)
  - rejects a non-numeric offset_seconds (422 at the Pydantic boundary)
"""

import shutil
import uuid

import pytest

from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id


def _seed_overlap_game():
    """Create a fresh profile DB with a two-video overlap game (both placed)."""
    from app.database import USER_DATA_BASE, ensure_database, get_db_connection

    user_id = f"test_t8900_{uuid.uuid4().hex[:8]}"
    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    ensure_database()

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO games (name) VALUES ('Overlap')")
        game_id = cur.lastrowid
        # seq 1: main camera at zero; seq 2: an angle placed 100s in, with a
        # recorded_at we must NEVER touch on a placement write.
        cur.execute(
            "INSERT INTO game_videos "
            "(game_id, blake3_hash, sequence, duration, offset_seconds, recorded_at) "
            "VALUES (?, 'h1', 1, 600.0, 0.0, '2026-07-18T10:00:00Z')",
            (game_id,),
        )
        cur.execute(
            "INSERT INTO game_videos "
            "(game_id, blake3_hash, sequence, duration, offset_seconds, recorded_at) "
            "VALUES (?, 'h2', 2, 300.0, 100.0, '2026-07-18T10:01:40Z')",
            (game_id,),
        )
        conn.commit()
    return user_id, game_id, USER_DATA_BASE / user_id


@pytest.fixture
def overlap_game(monkeypatch):
    import app.routers.games as games_mod

    monkeypatch.setattr(
        games_mod, "generate_presigned_url_global", lambda *a, **k: "https://x/v.mp4"
    )
    user_id, game_id, user_dir = _seed_overlap_game()
    try:
        yield game_id
    finally:
        if user_dir.exists():
            shutil.rmtree(user_dir, ignore_errors=True)


@pytest.mark.asyncio
async def test_happy_path_writes_offset_only(overlap_game):
    """Done -> offset_seconds updated, recorded_at untouched, updated row returned."""
    from app.database import get_db_connection
    from app.routers.games import PlacementUpdate, update_video_placement

    resp = await update_video_placement(
        overlap_game, 2, PlacementUpdate(offset_seconds=142.5)
    )
    assert resp["sequence"] == 2
    assert resp["offset_seconds"] == pytest.approx(142.5)
    # recorded_at must be exactly what it was — the endpoint never writes it.
    assert resp["recorded_at"] == "2026-07-18T10:01:40Z"

    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT offset_seconds, recorded_at FROM game_videos "
            "WHERE game_id = ? AND sequence = 2",
            (overlap_game,),
        ).fetchone()
    assert row["offset_seconds"] == pytest.approx(142.5)
    assert row["recorded_at"] == "2026-07-18T10:01:40Z"


@pytest.mark.asyncio
async def test_negative_offset_allowed(overlap_game):
    """A video recorded before the game's zero legally gets a negative offset."""
    from app.routers.games import PlacementUpdate, update_video_placement

    resp = await update_video_placement(
        overlap_game, 2, PlacementUpdate(offset_seconds=-30.0)
    )
    assert resp["offset_seconds"] == pytest.approx(-30.0)


@pytest.mark.asyncio
async def test_unknown_sequence_404(overlap_game):
    from fastapi import HTTPException

    from app.routers.games import PlacementUpdate, update_video_placement

    with pytest.raises(HTTPException) as exc:
        await update_video_placement(overlap_game, 99, PlacementUpdate(offset_seconds=5.0))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_unknown_game_404(overlap_game):
    from fastapi import HTTPException

    from app.routers.games import PlacementUpdate, update_video_placement

    with pytest.raises(HTTPException) as exc:
        await update_video_placement(999999, 1, PlacementUpdate(offset_seconds=5.0))
    assert exc.value.status_code == 404


def test_rejects_non_numeric_offset():
    """A non-numeric offset_seconds is a ValidationError (HTTP 422 at the boundary)."""
    from pydantic import ValidationError

    from app.routers.games import PlacementUpdate

    with pytest.raises(ValidationError):
        PlacementUpdate(offset_seconds="not-a-number")
