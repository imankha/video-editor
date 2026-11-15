"""
T16470: creating a first public game link must not freeze the server.

The first POST /api/games/{id}/share-link stitches the team recap (an ffmpeg
encode + R2 upload) via the synchronous ensure_recap(). Run on the event-loop
thread, every other request waits for the encode. These tests drive two
requests concurrently through the real ASGI app on ONE event loop: a slow
(blocking) ensure_recap must not delay a cheap /api/health request, and the
link must still wait for the recap / refuse an empty team layer.
"""

import asyncio
import threading
import time
from unittest.mock import AsyncMock, patch

import httpx

from tests.test_t5720_public_game_link import (  # noqa: F401  (fixtures)
    SHARER_ID,
    _auth_headers,
    _seed_game,
    _team_rail,
    client,
    isolated_auth_db,
)

ENCODE_SECONDS = 2.0


def _recap_result(game_id: int, status: str) -> dict:
    return {
        "status": status, "recap_key": f"recaps/{game_id}_team.mp4",
        "mapping_key": f"recaps/{game_id}_team_clips.json",
        "poster_key": f"recaps/posters/{game_id}_team.jpg",
        "clip_count": 0 if status == "empty" else 2,
    }


def _slow_ensure_recap(status: str, done: list, started: dict):
    def fake(user_id, profile_id, game_id, layer):
        started["at"] = time.perf_counter()
        started["event"].set()
        time.sleep(ENCODE_SECONDS)  # stands in for the blocking ffmpeg encode
        done.append(time.perf_counter())
        return _recap_result(game_id, status)
    return fake


async def _share_and_poll(game_id: int, started: dict):
    from app.main import app
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        share_task = asyncio.create_task(
            ac.post(f"/api/games/{game_id}/share-link", headers=_auth_headers())
        )
        # Wait (on the loop) until the encode has started. If the encode runs
        # on the loop thread, this poll -- like any other request -- only
        # resumes once the encode is over.
        while not started["event"].is_set():
            await asyncio.sleep(0.01)
        health = await ac.get("/api/health", headers=_auth_headers())
        # Latency of the cheap request measured from when the encode began.
        health_elapsed = time.perf_counter() - started["at"]
        share = await share_task
        share_returned = time.perf_counter()
    return share, share_returned, health, health_elapsed


def test_cheap_request_answers_during_first_share_encode(client):  # noqa: F811
    """T16470:C1 -- /api/health answers in under 1 s while the encode runs."""
    _seed_game(client, game_id=40)
    done: list = []
    started = {"event": threading.Event()}
    with patch("app.services.auto_export.ensure_recap", _slow_ensure_recap("stitched", done, started)), \
         patch("app.services.poster.warm_recap_poster", new_callable=AsyncMock), \
         patch("app.routers.games._build_team_clip_rail", return_value=_team_rail()):
        share, share_returned, health, health_elapsed = asyncio.run(_share_and_poll(40, started))
    assert health.status_code == 200
    assert health_elapsed < 1.0, (
        f"/api/health took {health_elapsed:.2f}s while a share-link recap encode "
        f"ran: the encode is blocking the event loop"
    )
    # C2: the link is only returned after the recap exists.
    assert share.status_code == 200, share.text
    assert share.json()["already_existed"] is False
    assert done and share_returned >= done[0]


def test_empty_team_layer_still_refused_off_loop(client):  # noqa: F811
    """T16470:C2 -- a game with no team plays is refused with the same message."""
    _seed_game(client, game_id=41)
    done: list = []
    started = {"event": threading.Event()}
    with patch("app.services.auto_export.ensure_recap", _slow_ensure_recap("empty", done, started)), \
         patch("app.services.poster.warm_recap_poster", new_callable=AsyncMock):
        share, _returned, _health, health_elapsed = asyncio.run(_share_and_poll(41, started))
    assert share.status_code == 409
    assert share.json()["detail"] == {
        "error": "empty_team_layer", "message": "Tag some team plays first",
    }
    from app.services.sharing_db import get_active_game_link_share
    assert get_active_game_link_share(41, SHARER_ID) is None
    assert health_elapsed < 1.0
