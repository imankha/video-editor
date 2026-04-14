"""
T1180: create_game must reject empty `videos`.

Root cause of NULL games.video_filename was the frontend creating a game
with videos=[] and attaching the video in a separate step. If the attach
step failed or the tab closed, the row persisted with video_filename=NULL,
blake3_hash=NULL, and no game_videos rows.

The backend now closes the door: create_game rejects videos=[].
"""

import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.routers.games import create_game, CreateGameRequest


@pytest.mark.asyncio
async def test_create_game_rejects_empty_videos():
    """Empty videos list must 400 before any DB write."""
    req = CreateGameRequest(videos=[], opponent_name="Test")
    with pytest.raises(HTTPException) as exc_info:
        await create_game(req)
    assert exc_info.value.status_code == 400
    assert "video" in exc_info.value.detail.lower()
