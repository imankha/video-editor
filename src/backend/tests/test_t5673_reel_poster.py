"""T5673: Published-reel poster endpoint (My Reels visual tiles).

Covers GET /api/downloads/{id}/poster.jpg -- the owner-facing serving path for
the T5280/T4890 publish poster, consumed by the drawer's poster tiles:

- 200 image/jpeg when the reel exists AND its poster object is present under the
  current profile prefix (key derived from the reel filename via poster_basename).
- 404 when the reel row is missing.
- 404 when the reel exists but has NO poster object (pre-T5280 reels) -- the
  branded fallback basis; no fabricated image (no-silent-fallback rule).
- Session auth: the route resolves the object under get_current_user_id() /
  get_current_profile_id() (per-profile media), never a global/other-profile key.
- _serve_reel_poster_jpeg: 404 (no presign) / 502 (bad R2 fetch).

Tests mock R2 + the DB row (no network, no real encode).
"""

import asyncio
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers import downloads
from app.services.poster import poster_basename, poster_rel_path

USER_ID = "test-user-t5673"
PROFILE_ID = "t5673prof"
DOWNLOAD_ID = 555
FILENAME = "reel_final_ab12cd34.mp4"
REL_PATH = poster_rel_path(poster_basename(FILENAME))  # final_videos/posters/reel_final_ab12cd34.mp4.jpg


def _fake_jpeg_client(status_code=200, content=b"\xff\xd8jpegbytes"):
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

def test_reel_poster_key_derives_from_filename():
    # The endpoint serves the SAME object the share-unfurl path derives:
    # final_videos/posters/{filename}.jpg, per-profile.
    assert REL_PATH == "final_videos/posters/reel_final_ab12cd34.mp4.jpg"


# ---------------------------------------------------------------------------
# GET /api/downloads/{id}/poster.jpg
# ---------------------------------------------------------------------------

def test_get_reel_poster_serves_jpeg_when_present():
    import httpx

    with patch.object(downloads, "get_db_connection", _fake_db_with_row({"filename": FILENAME})), \
         patch.object(downloads, "get_current_user_id", return_value=USER_ID), \
         patch.object(downloads, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(downloads, "profile_object_exists", return_value=True) as exists, \
         patch.object(downloads, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch.object(httpx, "AsyncClient", _fake_jpeg_client()):
        resp = asyncio.run(downloads.get_reel_poster(DOWNLOAD_ID))

    # Existence probed under the owner's CURRENT profile prefix (per-profile media).
    exists.assert_called_once_with(USER_ID, PROFILE_ID, REL_PATH)
    assert resp.media_type == "image/jpeg"
    assert resp.headers["cache-control"] == "private, max-age=300"
    assert resp.body == b"\xff\xd8jpegbytes"


def test_get_reel_poster_404_when_reel_missing():
    with patch.object(downloads, "get_db_connection", _fake_db_with_row(None)), \
         patch.object(downloads, "get_current_user_id", return_value=USER_ID), \
         patch.object(downloads, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(downloads, "profile_object_exists") as exists, \
         pytest.raises(HTTPException) as e:
        asyncio.run(downloads.get_reel_poster(DOWNLOAD_ID))
    assert e.value.status_code == 404
    # Never probes R2 for a nonexistent reel.
    exists.assert_not_called()


def test_get_reel_poster_404_when_no_poster_object():
    # Reel exists but its poster object is absent (pre-T5280 reel). Clean 404 ->
    # the drawer shows the branded fallback tile; NO fabricated image.
    with patch.object(downloads, "get_db_connection", _fake_db_with_row({"filename": FILENAME})), \
         patch.object(downloads, "get_current_user_id", return_value=USER_ID), \
         patch.object(downloads, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(downloads, "profile_object_exists", return_value=False), \
         patch.object(downloads, "generate_presigned_url") as presign, \
         pytest.raises(HTTPException) as e:
        asyncio.run(downloads.get_reel_poster(DOWNLOAD_ID))
    assert e.value.status_code == 404
    # Short-circuits before signing anything.
    presign.assert_not_called()


# ---------------------------------------------------------------------------
# _serve_reel_poster_jpeg
# ---------------------------------------------------------------------------

def test_serve_reel_poster_404_when_no_presign():
    with patch.object(downloads, "get_current_user_id", return_value=USER_ID), \
         patch.object(downloads, "generate_presigned_url", return_value=None), \
         pytest.raises(HTTPException) as e:
        asyncio.run(downloads._serve_reel_poster_jpeg(REL_PATH))
    assert e.value.status_code == 404


def test_serve_reel_poster_502_on_bad_fetch():
    import httpx

    with patch.object(downloads, "get_current_user_id", return_value=USER_ID), \
         patch.object(downloads, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch.object(httpx, "AsyncClient", _fake_jpeg_client(status_code=403)), \
         pytest.raises(HTTPException) as e:
        asyncio.run(downloads._serve_reel_poster_jpeg(REL_PATH))
    assert e.value.status_code == 502
