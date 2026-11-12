"""T15710: poster.jpg's profile-mismatch guard must answer like every other
branch of this <img>-consumed endpoint -- image/jpeg, never a JSON body.

A cross-origin <img> (staging frontend on pages.dev, backend on fly.dev) that
gets a JSON-bodied 403 instead of the image/jpeg this endpoint otherwise always
serves (every 404 branch explicitly sets media_type="image/jpeg") is the kind
of response-shape inconsistency that produced QA's one-off, unreproduced
"poster.jpg blocked by CORS" / "Preflight 403" console errors during a load
burst (several GameTile posters mounting at once -- a stale/raced profile_id
on the URL hits this exact branch far more often under a burst than in
isolation). This test locks in the fix: the guard now returns a Response,
not an HTTPException, with the same image/jpeg content type as its 404
siblings in the same function.
"""

import asyncio
from unittest.mock import MagicMock, patch

from app.routers import downloads, games, projects

USER_ID = "test-user-t15710"
PROFILE_A = "profileA-t15710"
PROFILE_B = "profileB-t15710"
ID = 1


def _fake_request():
    req = MagicMock()
    req.headers = {}
    return req


def test_games_poster_mismatch_returns_image_content_type():
    with patch.object(games, "get_current_profile_id", return_value=PROFILE_B):
        resp = asyncio.run(games.get_game_poster(ID, _fake_request(), profile_id=PROFILE_A))
    assert resp.status_code == 403
    assert resp.media_type == "image/jpeg"


def test_draft_poster_mismatch_returns_image_content_type():
    with patch("app.profile_context.get_current_profile_id", return_value=PROFILE_B), \
         patch.object(projects, "get_current_user_id", return_value=USER_ID):
        resp = asyncio.run(projects.get_draft_poster(ID, _fake_request(), profile_id=PROFILE_A))
    assert resp.status_code == 403
    assert resp.media_type == "image/jpeg"


def test_reel_poster_mismatch_returns_image_content_type():
    with patch.object(downloads, "get_current_profile_id", return_value=PROFILE_B):
        resp = asyncio.run(downloads.get_reel_poster(ID, _fake_request(), profile_id=PROFILE_A))
    assert resp.status_code == 403
    assert resp.media_type == "image/jpeg"
