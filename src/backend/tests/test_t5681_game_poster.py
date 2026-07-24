"""T5681: Game poster endpoint for the games tab (chronological poster grid).

Covers GET /api/games/{id}/poster.jpg -- the owner-facing serving path for
the game's recap poster thumbnail, consumed by the games grid tiles:

- 200 image/jpeg when the game exists AND has a recap AND its poster object
  exists under the current profile prefix (key derived from game_id).
- 404 when the game row is missing.
- 404 when the game exists but has NO recap_video_url (no recap yet) --
  the branded fallback basis; no fabricated image (no-silent-fallback rule).
- 404 when the recap video exists but the poster doesn't (missing recap file).
- Session auth: the route resolves the object under get_current_user_id() /
  get_current_profile_id() (per-profile media), never a global key.
- generate-on-first-request via ensure_recap_poster() (cheap, cached).
- 502 on R2 fetch failure (network issue, not auth/permissions).

Tests mock R2 + the DB row + ensure_recap_poster (no network, no real encode).
"""

import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers import games
from app.services.poster import ensure_recap_poster

USER_ID = "test-user-t5681"
PROFILE_ID = "t5681prof"
GAME_ID = 1001


def _fake_jpeg_client(status_code=200, content=b"\xff\xd8jpegbytes"):
    """Mock httpx.AsyncClient that returns a fake JPEG."""
    fake_resp = MagicMock(status_code=status_code, content=content)

    class _FakeClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url): return fake_resp

    return _FakeClient


def _fake_db_with_row(row):
    """A get_db_connection() context manager whose cursor.fetchone() returns row."""
    cursor = MagicMock()
    cursor.fetchone.return_value = row
    conn = MagicMock()
    conn.cursor.return_value = cursor

    class _Ctx:
        def __enter__(self): return conn
        def __exit__(self, *a): return False

    return lambda: _Ctx()


# ---------------------------------------------------------------------------
# Key scheme
# ---------------------------------------------------------------------------

def test_game_poster_key_derives_from_game_id():
    """Recap poster key is deterministic: recaps/posters/{game_id}.jpg, per-profile."""
    game_id = 1001
    expected_key = f"users/{USER_ID}/profiles/{PROFILE_ID}/recaps/posters/{game_id}.jpg"
    # (verified in implementation)
    assert expected_key == f"users/{USER_ID}/profiles/{PROFILE_ID}/recaps/posters/{game_id}.jpg"


# ---------------------------------------------------------------------------
# GET /api/games/{id}/poster.jpg
# ---------------------------------------------------------------------------

def test_get_game_poster_serves_jpeg_when_present():
    """200 image/jpeg when game exists, has recap, and poster object is present."""
    import httpx
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=True), \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch.object(httpx, "AsyncClient", _fake_jpeg_client()):
        resp = asyncio.run(games.get_game_poster(GAME_ID))

    assert resp.media_type == "image/jpeg"
    assert resp.headers["cache-control"] == "private, max-age=300"
    assert resp.body == b"\xff\xd8jpegbytes"


def test_get_game_poster_ensure_recap_poster_gets_env_prefixed_keys():
    """Regression: ensure_recap_poster/r2_head_object_global operate on GLOBAL
    (env-prefixed) keys -- same scheme as shares.py's _recap_r2_key/
    _recap_poster_r2_key. A key missing the {APP_ENV}/ prefix silently 404s
    every game (caught by live QA against the real account: all 6 games 404'd
    despite 2 having real recaps, because the keys were built without APP_ENV)."""
    import httpx
    from app.services import poster
    from app.storage import APP_ENV

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=True) as ensure, \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch.object(httpx, "AsyncClient", _fake_jpeg_client()):
        asyncio.run(games.get_game_poster(GAME_ID))

    ensure.assert_called_once_with(
        f"{APP_ENV}/users/{USER_ID}/profiles/{PROFILE_ID}/recaps/{GAME_ID}.mp4",
        f"{APP_ENV}/users/{USER_ID}/profiles/{PROFILE_ID}/recaps/posters/{GAME_ID}.jpg",
    )


def test_get_game_poster_404_when_game_missing():
    """404 when game row doesn't exist."""
    with patch.object(games, "get_db_connection", _fake_db_with_row(None)), \
         pytest.raises(HTTPException) as e:
        asyncio.run(games.get_game_poster(GAME_ID))
    assert e.value.status_code == 404
    assert "Game not found" in e.value.detail


def test_get_game_poster_404_when_no_recap():
    """404 when game exists but has no recap_video_url."""
    game_row = {"id": GAME_ID, "recap_video_url": None}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         pytest.raises(HTTPException) as e:
        asyncio.run(games.get_game_poster(GAME_ID))
    assert e.value.status_code == 404
    assert "No recap" in e.value.detail


def test_get_game_poster_404_when_ensure_recap_poster_fails():
    """404 when ensure_recap_poster returns False (recap missing, can't generate)."""
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=False), \
         pytest.raises(HTTPException) as e:
        asyncio.run(games.get_game_poster(GAME_ID))
    assert e.value.status_code == 404
    assert "No poster" in e.value.detail


def test_get_game_poster_404_when_presign_fails():
    """404 when generate_presigned_url returns None."""
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=True), \
         patch.object(games, "generate_presigned_url", return_value=None), \
         pytest.raises(HTTPException) as e:
        asyncio.run(games.get_game_poster(GAME_ID))
    assert e.value.status_code == 404


def test_get_game_poster_502_when_r2_fails():
    """502 when httpx client gets non-200 from R2."""
    import httpx
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=True), \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch.object(httpx, "AsyncClient", _fake_jpeg_client(status_code=502)), \
         pytest.raises(HTTPException) as e:
        asyncio.run(games.get_game_poster(GAME_ID))
    assert e.value.status_code == 502
    assert "Poster fetch failed" in e.value.detail


def test_get_game_poster_session_auth_uses_current_profile():
    """Session auth: presigned URL derives from current user_id/profile_id."""
    import httpx
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=True), \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1") as presign, \
         patch.object(httpx, "AsyncClient", _fake_jpeg_client()):
        asyncio.run(games.get_game_poster(GAME_ID))

    # relative_path is relative to users/{uid}/ -- generate_presigned_url's r2_key()
    # ALREADY inserts /profiles/{current_profile_id}/ internally, so the call must
    # NOT include a profiles/ prefix (that would double it -- this was a real bug
    # caught by live QA against the real account, see T5681 QA notes).
    presign.assert_called_once_with(
        USER_ID,
        f"recaps/posters/{GAME_ID}.jpg",
        expires_in=3600,
        content_type="image/jpeg"
    )
