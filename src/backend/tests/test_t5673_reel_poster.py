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


def _fake_poster_r2_client(status_code=200, content=b"\xff\xd8jpegbytes", etag='"r2etag123"'):
    """A stand-in for storage.get_poster_r2_client() -- the pooled client used
    to fetch a presigned R2 URL (T5682, replaces the old per-request
    httpx.AsyncClient())."""
    from unittest.mock import AsyncMock
    fake_resp = MagicMock(status_code=status_code, content=content)
    fake_resp.headers = {"etag": etag} if etag else {}
    client = MagicMock()
    client.get = AsyncMock(return_value=fake_resp)
    return client


def _fake_request(if_none_match=None):
    """A minimal Request stand-in exposing .headers.get() (T5682)."""
    req = MagicMock()
    req.headers = {"if-none-match": if_none_match} if if_none_match else {}
    return req


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
    # This is the FULL-SIZE og:image object the share-unfurl path also reads
    # (T5682: NEVER resized -- the My Reels tile serves a separate card-size
    # thumbnail derived from this one, see ensure_reel_card_poster).
    assert REL_PATH == "final_videos/posters/reel_final_ab12cd34.mp4.jpg"


# ---------------------------------------------------------------------------
# GET /api/downloads/{id}/poster.jpg
# ---------------------------------------------------------------------------

def test_get_reel_poster_serves_card_thumb_when_present():
    # T5682: the tile serves the SEPARATE card-size thumb, not the full-size
    # og:image object -- ensure_reel_card_poster is called and its path served.
    card_path = "final_videos/posters/reel_final_ab12cd34.mp4.card.jpg"
    with patch.object(downloads, "get_db_connection", _fake_db_with_row({"filename": FILENAME})), \
         patch.object(downloads, "get_current_user_id", return_value=USER_ID), \
         patch.object(downloads, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(downloads, "profile_object_exists", return_value=True) as exists, \
         patch("app.services.poster.ensure_reel_card_poster", return_value=card_path) as ensure_card, \
         patch.object(downloads, "generate_presigned_url") as presign, \
         patch("app.storage.get_poster_r2_client", return_value=_fake_poster_r2_client()):
        presign.return_value = "https://r2/card.jpg?sig=1"
        resp = asyncio.run(downloads.get_reel_poster(DOWNLOAD_ID, _fake_request()))

    # Existence probed under the owner's CURRENT profile prefix (per-profile media)
    # against the FULL-SIZE key (the og:image object must exist before we bother
    # generating a card thumb from it).
    exists.assert_called_once_with(USER_ID, PROFILE_ID, REL_PATH)
    ensure_card.assert_called_once_with(USER_ID, poster_basename(FILENAME))
    # The card path (not the full-size REL_PATH) is what gets presigned/served.
    presign.assert_called_once_with(USER_ID, card_path, expires_in=3600, content_type="image/jpeg")
    assert resp.media_type == "image/jpeg"
    assert resp.headers["cache-control"] == "private, max-age=86400"  # T5682: long cache + ETag
    assert "etag" in resp.headers  # T5682: ETag for 304 hits
    assert resp.body == b"\xff\xd8jpegbytes"


def test_get_reel_poster_falls_back_to_full_size_when_card_gen_fails():
    # T5682: card generation failure (transient) degrades gracefully to serving
    # the full-size poster rather than 404ing a reel that DOES have a poster.
    with patch.object(downloads, "get_db_connection", _fake_db_with_row({"filename": FILENAME})), \
         patch.object(downloads, "get_current_user_id", return_value=USER_ID), \
         patch.object(downloads, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(downloads, "profile_object_exists", return_value=True), \
         patch("app.services.poster.ensure_reel_card_poster", return_value=None), \
         patch.object(downloads, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1") as presign, \
         patch("app.storage.get_poster_r2_client", return_value=_fake_poster_r2_client()):
        resp = asyncio.run(downloads.get_reel_poster(DOWNLOAD_ID, _fake_request()))

    presign.assert_called_once_with(USER_ID, REL_PATH, expires_in=3600, content_type="image/jpeg")
    assert resp.media_type == "image/jpeg"


def test_get_reel_poster_404_when_reel_missing():
    with patch.object(downloads, "get_db_connection", _fake_db_with_row(None)), \
         patch.object(downloads, "get_current_user_id", return_value=USER_ID), \
         patch.object(downloads, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(downloads, "profile_object_exists") as exists:
        resp = asyncio.run(downloads.get_reel_poster(DOWNLOAD_ID, _fake_request()))
    # T5682: negative cache on 404s
    assert resp.status_code == 404
    assert resp.headers["cache-control"] == "private, max-age=60"
    # Never probes R2 for a nonexistent reel.
    exists.assert_not_called()


def test_get_reel_poster_404_when_no_poster_object():
    # Reel exists but its poster object is absent (pre-T5280 reel). Clean 404 ->
    # the drawer shows the branded fallback tile; NO fabricated image.
    with patch.object(downloads, "get_db_connection", _fake_db_with_row({"filename": FILENAME})), \
         patch.object(downloads, "get_current_user_id", return_value=USER_ID), \
         patch.object(downloads, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(downloads, "profile_object_exists", return_value=False), \
         patch.object(downloads, "generate_presigned_url") as presign:
        resp = asyncio.run(downloads.get_reel_poster(DOWNLOAD_ID, _fake_request()))
    # T5682: negative cache on 404s
    assert resp.status_code == 404
    assert resp.headers["cache-control"] == "private, max-age=60"
    # Short-circuits before signing anything.
    presign.assert_not_called()


def test_get_reel_poster_304_when_if_none_match_matches():
    # T5682: matching If-None-Match short-circuits to 304 via a SINGLE HEAD
    # against the deterministic card key -- BEFORE profile_object_exists or
    # ensure_reel_card_poster run their own HEADs.
    from app.services.poster import reel_card_poster_rel_path
    expected_card_path = reel_card_poster_rel_path(poster_basename(FILENAME))

    with patch.object(downloads, "get_db_connection", _fake_db_with_row({"filename": FILENAME})), \
         patch.object(downloads, "get_current_user_id", return_value=USER_ID), \
         patch.object(downloads, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(downloads, "profile_object_exists") as exists, \
         patch("app.services.poster.ensure_reel_card_poster") as ensure_card, \
         patch("app.storage.r2_head_object", return_value={"ETag": '"r2etag123"'}) as head:
        resp = asyncio.run(downloads.get_reel_poster(DOWNLOAD_ID, _fake_request('"r2etag123"')))

    assert resp.status_code == 304
    head.assert_called_once_with(USER_ID, expected_card_path)
    # Short-circuited before the existence check / card generation ran at all.
    exists.assert_not_called()
    ensure_card.assert_not_called()


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
    with patch.object(downloads, "get_current_user_id", return_value=USER_ID), \
         patch.object(downloads, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch("app.storage.get_poster_r2_client", return_value=_fake_poster_r2_client(status_code=403)), \
         pytest.raises(HTTPException) as e:
        asyncio.run(downloads._serve_reel_poster_jpeg(REL_PATH))
    assert e.value.status_code == 502


# ---------------------------------------------------------------------------
# ensure_reel_card_poster (T5682): card-size thumb downscaled from the
# EXISTING full-size og:image JPEG, stored at a SEPARATE key.
# ---------------------------------------------------------------------------

def test_ensure_reel_card_poster_cache_hit_no_resize():
    from app.services import poster as poster_mod

    with patch("app.storage.file_exists_in_r2", return_value=True), \
         patch.object(poster_mod, "_resize_jpeg") as resize, \
         patch("app.storage.upload_bytes_to_r2") as up:
        result = poster_mod.ensure_reel_card_poster(USER_ID, poster_basename(FILENAME))

    assert result == poster_mod.reel_card_poster_rel_path(poster_basename(FILENAME))
    resize.assert_not_called()
    up.assert_not_called()


def test_ensure_reel_card_poster_generates_from_existing_full_size(tmp_path):
    from app.services import poster as poster_mod

    captured = {}

    def fake_resize(source_path, output_path, width, jpeg_quality):
        captured["source_path"] = source_path
        captured["width"] = width
        captured["jpeg_quality"] = jpeg_quality
        from pathlib import Path
        Path(output_path).write_bytes(b"\xff\xd8smallcard")
        return True

    def fake_upload(user_id, rel_path, data, *, fast=False, content_type=None, metadata=None):
        captured.update(up_user=user_id, up_key=rel_path, size=len(data))
        return True

    with patch("app.storage.file_exists_in_r2", return_value=False), \
         patch.object(poster_mod, "generate_presigned_url", return_value="https://r2/full.jpg?sig=1"), \
         patch.object(poster_mod, "_resize_jpeg", side_effect=fake_resize), \
         patch.object(poster_mod, "_jpeg_dimensions", return_value=(480, 270)), \
         patch("app.storage.upload_bytes_to_r2", side_effect=fake_upload):
        result = poster_mod.ensure_reel_card_poster(USER_ID, poster_basename(FILENAME))

    expected_card_path = poster_mod.reel_card_poster_rel_path(poster_basename(FILENAME))
    assert result == expected_card_path
    assert captured["source_path"] == "https://r2/full.jpg?sig=1"  # downscales the FULL-SIZE object
    assert captured["width"] == 480
    assert captured["up_key"] == expected_card_path


def test_ensure_reel_card_poster_none_when_no_full_size_poster():
    from app.services import poster as poster_mod

    with patch("app.storage.file_exists_in_r2", return_value=False), \
         patch.object(poster_mod, "generate_presigned_url", return_value=None), \
         patch.object(poster_mod, "_resize_jpeg") as resize:
        assert poster_mod.ensure_reel_card_poster(USER_ID, poster_basename(FILENAME)) is None
    resize.assert_not_called()


def test_ensure_reel_card_poster_never_raises():
    from app.services import poster as poster_mod

    with patch("app.storage.file_exists_in_r2", side_effect=RuntimeError("r2 down")):
        assert poster_mod.ensure_reel_card_poster(USER_ID, poster_basename(FILENAME)) is None
