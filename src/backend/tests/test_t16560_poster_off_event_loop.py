"""T16560: the game poster endpoint must not block the event loop while it makes a card.

T10540 made GET /api/games/{id}/poster.jpg run ensure_game_source_poster for every
game, and every card made before T10540 (no source metadata) is remade on its first
request: an R2 HEAD, a presign and an ffmpeg frame seek. Called directly inside the
async endpoint, that work held the event loop, so the first Home visit after the
deploy stalled every other request once per tile (the T10540:C10 staging check timed
out at 180s). The poster makers are blocking by contract (their docstrings say callers
on the event loop wrap them in asyncio.to_thread).
"""

import asyncio
import threading
from unittest.mock import MagicMock, patch

from app.routers import games
from app.services import poster
from tests.test_t10540_game_poster_top_play import (
    GAME_ID,
    PROFILE_ID,
    USER_ID,
    _fake_db_with_row,
    _poster_client,
)

WAIT_SECONDS = 2.0


def _serve_while_generating(row, blocking_target):
    """Request a poster whose `blocking_target` maker blocks until another coroutine
    on the same loop has run. Returns (response, whether the loop stayed free)."""
    loop_ran = threading.Event()

    def blocking_maker(*_args, **_kwargs):
        # On the event loop thread this wait can never be satisfied: the other
        # coroutine only runs once the loop gets control back.
        return loop_ran.wait(WAIT_SECONDS)

    async def other_request():
        await asyncio.sleep(0)
        loop_ran.set()

    async def both():
        req = MagicMock()
        req.headers = {}
        other = asyncio.create_task(other_request())
        resp = await games.get_game_poster(GAME_ID, req)
        await other
        return resp

    makers = {"ensure_game_source_poster": lambda *a: False, "ensure_recap_poster": lambda *a: True}
    makers[blocking_target] = blocking_maker
    with patch.object(games, "get_db_connection", _fake_db_with_row(row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_game_source_poster", side_effect=makers["ensure_game_source_poster"]), \
         patch.object(poster, "ensure_recap_poster", side_effect=makers["ensure_recap_poster"]), \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg"), \
         patch("app.storage.get_poster_r2_client", return_value=_poster_client()):
        resp = asyncio.run(both())
    return resp, loop_ran.is_set()


def test_source_poster_is_made_off_the_event_loop():
    resp, loop_free = _serve_while_generating(
        {"id": GAME_ID, "recap_video_url": None}, "ensure_game_source_poster")
    assert loop_free, "ensure_game_source_poster ran on the event loop and blocked other requests"
    assert resp.status_code == 200


def test_recap_poster_is_made_off_the_event_loop():
    resp, loop_free = _serve_while_generating(
        {"id": GAME_ID, "recap_video_url": "r.mp4"}, "ensure_recap_poster")
    assert loop_free, "ensure_recap_poster ran on the event loop and blocked other requests"
    assert resp.status_code == 200
