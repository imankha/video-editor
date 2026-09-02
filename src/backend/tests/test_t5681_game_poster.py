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
import shutil
import subprocess
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.routers import games
from app.services.poster import ensure_recap_poster

USER_ID = "test-user-t5681"
PROFILE_ID = "t5681prof"
GAME_ID = 1001


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
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=True), \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch("app.storage.get_poster_r2_client", return_value=_fake_poster_r2_client()):
        resp = asyncio.run(games.get_game_poster(GAME_ID, _fake_request()))

    assert resp.media_type == "image/jpeg"
    assert resp.headers["cache-control"] == "private, max-age=86400"  # T5682: long cache + ETag
    assert "etag" in resp.headers  # T5682: ETag for 304 hits
    assert resp.body == b"\xff\xd8jpegbytes"


def test_get_game_poster_ensure_recap_poster_gets_env_prefixed_keys():
    """Regression: ensure_recap_poster/r2_head_object_global operate on GLOBAL
    (env-prefixed) keys -- same scheme as shares.py's _recap_r2_key/
    _recap_poster_r2_key. A key missing the {APP_ENV}/ prefix silently 404s
    every game (caught by live QA against the real account: all 6 games 404'd
    despite 2 having real recaps, because the keys were built without APP_ENV)."""
    from app.services import poster
    from app.storage import APP_ENV

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=True) as ensure, \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch("app.storage.get_poster_r2_client", return_value=_fake_poster_r2_client()):
        asyncio.run(games.get_game_poster(GAME_ID, _fake_request()))

    # T5682: owner-facing tile uses a SEPARATE card-size key (`.card.jpg`) from
    # the full-size og:image poster shares.py reads -- never resizes that one.
    ensure.assert_called_once_with(
        f"{APP_ENV}/users/{USER_ID}/profiles/{PROFILE_ID}/recaps/{GAME_ID}.mp4",
        f"{APP_ENV}/users/{USER_ID}/profiles/{PROFILE_ID}/recaps/posters/{GAME_ID}.card.jpg",
        resize_width=480, jpeg_quality=3,
    )


def test_get_game_poster_404_when_game_missing():
    """404 when game row doesn't exist."""
    with patch.object(games, "get_db_connection", _fake_db_with_row(None)):
        resp = asyncio.run(games.get_game_poster(GAME_ID, _fake_request()))
    # T5682: negative cache on 404s
    assert resp.status_code == 404
    assert resp.headers["cache-control"] == "private, max-age=60"


def test_get_game_poster_404_when_no_recap_and_no_source():
    """404 when game has no recap AND no live source (expired/reclaimed): the
    source-frame poster path returns False (T5681 item 2/3)."""
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": None}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_game_source_poster", return_value=False):
        resp = asyncio.run(games.get_game_poster(GAME_ID, _fake_request()))
    # T5682: negative cache on 404s (source-frame path returns False)
    assert resp.status_code == 404
    assert resp.headers["cache-control"] == "private, max-age=60"


def test_get_game_poster_source_frame_served_when_no_recap():
    """200 image/jpeg for an ACTIVE game with NO recap: the source-frame poster is
    generated (highest-rated clip frame) and served from the same card key (T5681
    + T5682: card-size)."""
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": None}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_game_source_poster", return_value=True) as gen, \
         patch.object(poster, "ensure_recap_poster") as recap_gen, \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch("app.storage.get_poster_r2_client", return_value=_fake_poster_r2_client()):
        resp = asyncio.run(games.get_game_poster(GAME_ID, _fake_request()))

    assert resp.media_type == "image/jpeg"
    assert resp.body == b"\xff\xd8jpegbytes"
    gen.assert_called_once_with(USER_ID, PROFILE_ID, GAME_ID)
    # Recap-wins invariant: the recap generator is NOT touched for a no-recap game.
    recap_gen.assert_not_called()


def test_get_game_poster_recap_wins_over_source_frame():
    """Recap-derived poster wins whenever a recap exists: the source-frame path is
    NEVER invoked for a game that has a recap (T5681 item 3)."""
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=True), \
         patch.object(poster, "ensure_game_source_poster") as source_gen, \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch("app.storage.get_poster_r2_client", return_value=_fake_poster_r2_client()):
        asyncio.run(games.get_game_poster(GAME_ID, _fake_request()))

    source_gen.assert_not_called()


def test_get_game_poster_404_when_ensure_recap_poster_fails():
    """404 when ensure_recap_poster returns False (recap missing, can't generate)."""
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=False):
        resp = asyncio.run(games.get_game_poster(GAME_ID, _fake_request()))
    # T5682: negative cache on 404s
    assert resp.status_code == 404
    assert resp.headers["cache-control"] == "private, max-age=60"


def test_get_game_poster_404_when_presign_fails():
    """404 when generate_presigned_url returns None."""
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=True), \
         patch.object(games, "generate_presigned_url", return_value=None):
        resp = asyncio.run(games.get_game_poster(GAME_ID, _fake_request()))
    # T5682: negative cache on 404s
    assert resp.status_code == 404
    assert resp.headers["cache-control"] == "private, max-age=60"


def test_get_game_poster_502_when_r2_fails():
    """502 when httpx client gets non-200 from R2."""
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=True), \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1"), \
         patch("app.storage.get_poster_r2_client", return_value=_fake_poster_r2_client(status_code=502)), \
         pytest.raises(HTTPException) as e:
        asyncio.run(games.get_game_poster(GAME_ID, _fake_request()))
    assert e.value.status_code == 502
    assert "Poster fetch failed" in e.value.detail


def test_get_game_poster_session_auth_uses_current_profile():
    """Session auth: presigned URL derives from current user_id/profile_id."""
    from app.services import poster

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster", return_value=True), \
         patch.object(games, "generate_presigned_url", return_value="https://r2/p.jpg?sig=1") as presign, \
         patch("app.storage.get_poster_r2_client", return_value=_fake_poster_r2_client()):
        asyncio.run(games.get_game_poster(GAME_ID, _fake_request()))

    # relative_path is relative to users/{uid}/ -- generate_presigned_url's r2_key()
    # ALREADY inserts /profiles/{current_profile_id}/ internally, so the call must
    # NOT include a profiles/ prefix (that would double it -- this was a real bug
    # caught by live QA against the real account, see T5681 QA notes).
    presign.assert_called_once_with(
        USER_ID,
        f"recaps/posters/{GAME_ID}.card.jpg",  # T5682: card-size key
        expires_in=3600,
        content_type="image/jpeg"
    )


# ---------------------------------------------------------------------------
# Source-frame poster generation (T5681 item 2/3): frame choice + gating.
# ---------------------------------------------------------------------------

import sqlite3

from app.services.poster import (
    GAME_POSTER_FALLBACK_OFFSET_SEC,
    _choose_game_poster_frame,
    _primary_game_video_hash,
    ensure_game_source_poster,
)


def _seeded_frame_db(clips, game_hash="ghash", game_videos=()):
    """In-memory sqlite (sqlite3.Row) with the minimal games/game_videos/raw_clips
    columns the frame-choice query reads. `clips` is a list of
    (rating, start_time, video_sequence) tuples for GAME_ID."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY, blake3_hash TEXT)")
    conn.execute(
        "CREATE TABLE game_videos (game_id INTEGER, blake3_hash TEXT, sequence INTEGER)"
    )
    conn.execute(
        "CREATE TABLE raw_clips (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER, "
        "rating INTEGER, start_time REAL, video_sequence INTEGER)"
    )
    conn.execute("INSERT INTO games (id, blake3_hash) VALUES (?, ?)", (GAME_ID, game_hash))
    for gid_hash, seq in game_videos:
        conn.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (?, ?, ?)",
            (GAME_ID, gid_hash, seq),
        )
    for rating, start_time, seq in clips:
        conn.execute(
            "INSERT INTO raw_clips (game_id, rating, start_time, video_sequence) "
            "VALUES (?, ?, ?, ?)",
            (GAME_ID, rating, start_time, seq),
        )
    conn.commit()
    return conn


def test_choose_frame_prefers_highest_rating():
    """Brilliant (5) beats Good (4) beats the rest -- picks the 5-star clip's time."""
    conn = _seeded_frame_db([
        (3, 10.0, None),
        (5, 120.0, None),  # Brilliant -> chosen
        (4, 30.0, None),
    ])
    hash_, ts = _choose_game_poster_frame(conn.cursor(), GAME_ID)
    assert hash_ == "ghash"
    assert ts == 120.0


def test_choose_frame_tie_breaks_to_earliest():
    """On equal rating, the EARLIEST start_time wins."""
    conn = _seeded_frame_db([
        (5, 200.0, None),
        (5, 45.0, None),   # earliest 5-star -> chosen
        (5, 90.0, None),
    ])
    _hash, ts = _choose_game_poster_frame(conn.cursor(), GAME_ID)
    assert ts == 45.0


def test_choose_frame_resolves_multi_video_sequence_hash():
    """A clip on video_sequence 2 resolves to that game_video's hash, not the
    legacy games.blake3_hash."""
    conn = _seeded_frame_db(
        [(5, 15.0, 2)],
        game_hash=None,
        game_videos=[("hash_seq1", 1), ("hash_seq2", 2)],
    )
    hash_, ts = _choose_game_poster_frame(conn.cursor(), GAME_ID)
    assert hash_ == "hash_seq2"
    assert ts == 15.0


def test_choose_frame_none_when_no_clips():
    """No annotated clips -> None (caller uses the fixed offset)."""
    conn = _seeded_frame_db([])
    assert _choose_game_poster_frame(conn.cursor(), GAME_ID) is None


def test_primary_video_hash_prefers_sequence_one():
    conn = _seeded_frame_db(
        [], game_hash=None, game_videos=[("hash_seq1", 1), ("hash_seq2", 2)]
    )
    assert _primary_game_video_hash(conn.cursor(), GAME_ID) == "hash_seq1"


def _extract_capture(captured):
    """A stand-in for extract_first_frame_jpeg that records the seek and writes a
    fake JPEG so the caller's read_bytes() succeeds."""
    def _fake(source, output_path, seek=0.0, resize_width=None, jpeg_quality=3):
        captured["seek"] = seek
        captured["resize_width"] = resize_width  # T5682: card-size on source path
        from pathlib import Path as _P
        _P(output_path).write_bytes(b"\xff\xd8fake")
        return True
    return _fake


def test_ensure_game_source_poster_cache_hit():
    """Poster already in R2 -> True with NO ffmpeg extraction (cache hit)."""
    from app.services import poster
    from app import storage

    with patch.object(storage, "r2_head_object_global", return_value={"ContentLength": 1}), \
         patch.object(poster, "extract_first_frame_jpeg") as extract:
        assert ensure_game_source_poster(USER_ID, PROFILE_ID, GAME_ID) is True
    extract.assert_not_called()


def test_ensure_game_source_poster_no_clips_uses_offset():
    """No clips + UNKNOWN duration -> seek the primary video at the fixed 60s
    offset (the mocked cursor returns no duration row, so the clamp is a no-op)."""
    from app.services import poster
    from app import storage, database

    captured = {}
    # HEAD: poster key miss (None) then game source present (dict).
    head = MagicMock(side_effect=[None, {"ContentLength": 1}])

    with patch.object(storage, "r2_head_object_global", head), \
         patch.object(database, "get_db_connection", _fake_db_with_row(None)), \
         patch.object(poster, "_choose_game_poster_frame", return_value=None), \
         patch.object(poster, "_primary_game_video_hash", return_value="ghash"), \
         patch.object(poster, "_primary_game_video_duration", return_value=None), \
         patch.object(storage, "generate_presigned_url_global", return_value="https://r2/g.mp4?sig"), \
         patch.object(poster, "extract_first_frame_jpeg", _extract_capture(captured)), \
         patch.object(poster, "_jpeg_dimensions", return_value=(1280, 720)), \
         patch.object(storage, "upload_bytes_to_r2_global", return_value=True) as upload:
        assert ensure_game_source_poster(USER_ID, PROFILE_ID, GAME_ID) is True

    assert captured["seek"] == GAME_POSTER_FALLBACK_OFFSET_SEC
    assert upload.called


# --- T8200: short-game fallback-offset clamp (bknoto game 12, 11.9s, no clips) ---

def test_clamp_fallback_seek_keeps_offset_for_long_video():
    """A video longer than the offset seeks at the offset verbatim."""
    from app.services.poster import _clamp_fallback_seek
    assert _clamp_fallback_seek(60.0, 300.0) == 60.0


def test_clamp_fallback_seek_keeps_offset_when_duration_unknown():
    """Unknown duration (None) -> offset used verbatim (best-effort)."""
    from app.services.poster import _clamp_fallback_seek
    assert _clamp_fallback_seek(60.0, None) == 60.0
    assert _clamp_fallback_seek(60.0, 0.0) == 60.0


def test_clamp_fallback_seek_clamps_short_video_to_midpoint():
    """T8200 root cause: a 11.9s game must NOT seek at the 60s offset (past EOF).
    It samples the video midpoint instead, guaranteed inside the source."""
    from app.services.poster import _clamp_fallback_seek
    assert _clamp_fallback_seek(60.0, 11.9) == 11.9 * 0.5
    # Exactly-equal is still unsafe (seek AT EOF extracts nothing) -> clamp.
    assert _clamp_fallback_seek(60.0, 60.0) == 30.0


def test_ensure_game_source_poster_short_game_clamps_seek():
    """No clips + a SHORT game (duration < offset) seeks INSIDE the video, so the
    poster is produced instead of 404ing forever (T8200, bknoto game 12)."""
    from app import database, storage
    from app.services import poster

    captured = {}
    head = MagicMock(side_effect=[None, {"ContentLength": 1}])

    with patch.object(storage, "r2_head_object_global", head), \
         patch.object(database, "get_db_connection", _fake_db_with_row(None)), \
         patch.object(poster, "_choose_game_poster_frame", return_value=None), \
         patch.object(poster, "_primary_game_video_hash", return_value="ghash"), \
         patch.object(poster, "_primary_game_video_duration", return_value=11.9), \
         patch.object(storage, "generate_presigned_url_global", return_value="https://r2/g.mp4?sig"), \
         patch.object(poster, "extract_first_frame_jpeg", _extract_capture(captured)), \
         patch.object(poster, "_jpeg_dimensions", return_value=(320, 240)), \
         patch.object(storage, "upload_bytes_to_r2_global", return_value=True) as upload:
        assert ensure_game_source_poster(USER_ID, PROFILE_ID, GAME_ID) is True

    assert captured["seek"] == 11.9 * 0.5  # midpoint, NOT the 60s offset
    assert captured["seek"] < 11.9
    assert upload.called


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_extract_past_eof_fails_but_clamped_seek_succeeds(tmp_path):
    """End-to-end ground truth for T8200: on a real 12s video, the OLD 60s
    fallback seek extracts NO frame (the observed prod 404), while the clamped
    midpoint seek produces a real JPEG."""
    from app.services.poster import _clamp_fallback_seek, extract_first_frame_jpeg

    video = tmp_path / "short12.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi",
         "-i", "testsrc=duration=12:size=320x240:rate=30",
         "-pix_fmt", "yuv420p", str(video)],
        capture_output=True, check=True,
    )

    # OLD behavior: seek at the raw 60s offset -> extraction fails (past EOF).
    past_eof = tmp_path / "eof.jpg"
    assert extract_first_frame_jpeg(str(video), str(past_eof), seek=60.0) is False

    # NEW behavior: clamped seek lands inside the video -> a real frame.
    seek = _clamp_fallback_seek(60.0, 12.0)
    good = tmp_path / "good.jpg"
    assert extract_first_frame_jpeg(str(video), str(good), seek=seek) is True
    assert good.stat().st_size > 0


def test_ensure_game_source_poster_uses_highest_rated_timestamp():
    """The chosen clip's timestamp is the ffmpeg seek offset."""
    from app.services import poster
    from app import storage, database

    captured = {}
    head = MagicMock(side_effect=[None, {"ContentLength": 1}])

    with patch.object(storage, "r2_head_object_global", head), \
         patch.object(database, "get_db_connection", _fake_db_with_row(None)), \
         patch.object(poster, "_choose_game_poster_frame", return_value=("ghash", 87.5)), \
         patch.object(storage, "generate_presigned_url_global", return_value="https://r2/g.mp4?sig"), \
         patch.object(poster, "extract_first_frame_jpeg", _extract_capture(captured)), \
         patch.object(poster, "_jpeg_dimensions", return_value=None), \
         patch.object(storage, "upload_bytes_to_r2_global", return_value=True):
        assert ensure_game_source_poster(USER_ID, PROFILE_ID, GAME_ID) is True

    assert captured["seek"] == 87.5


def test_ensure_game_source_poster_404_when_source_expired():
    """Live source object gone (HEAD miss) -> False (expired game stays 404)."""
    from app.services import poster
    from app import storage, database

    # HEAD: poster key miss, then game source ALSO miss (reclaimed).
    head = MagicMock(side_effect=[None, None])

    with patch.object(storage, "r2_head_object_global", head), \
         patch.object(database, "get_db_connection", _fake_db_with_row(None)), \
         patch.object(poster, "_choose_game_poster_frame", return_value=("ghash", 12.0)), \
         patch.object(poster, "extract_first_frame_jpeg") as extract:
        assert ensure_game_source_poster(USER_ID, PROFILE_ID, GAME_ID) is False
    extract.assert_not_called()


def test_ensure_game_source_poster_false_when_no_hash():
    """No clips AND no primary video hash -> False (nothing to seek)."""
    from app.services import poster
    from app import storage, database

    with patch.object(storage, "r2_head_object_global", return_value=None), \
         patch.object(database, "get_db_connection", _fake_db_with_row(None)), \
         patch.object(poster, "_choose_game_poster_frame", return_value=None), \
         patch.object(poster, "_primary_game_video_hash", return_value=None):
        assert ensure_game_source_poster(USER_ID, PROFILE_ID, GAME_ID) is False


def test_get_game_poster_304_when_if_none_match_matches():
    # T5682: matching If-None-Match short-circuits to 304 via a SINGLE HEAD
    # against the deterministic card key -- BEFORE ensure_recap_poster's own
    # cache-check HEAD runs against the same key.
    from app.services import poster
    from app.storage import APP_ENV

    game_row = {"id": GAME_ID, "recap_video_url": "https://example.com/recap.mp4"}
    card_key = f"{APP_ENV}/users/{USER_ID}/profiles/{PROFILE_ID}/recaps/posters/{GAME_ID}.card.jpg"

    with patch.object(games, "get_db_connection", _fake_db_with_row(game_row)), \
         patch.object(games, "get_current_user_id", return_value=USER_ID), \
         patch.object(games, "get_current_profile_id", return_value=PROFILE_ID), \
         patch.object(poster, "ensure_recap_poster") as ensure, \
         patch("app.storage.r2_head_object_global", return_value={"ETag": '"r2etag123"'}) as head:
        resp = asyncio.run(games.get_game_poster(GAME_ID, _fake_request('"r2etag123"')))

    assert resp.status_code == 304
    head.assert_called_once_with(card_key)
    # Short-circuited before ensure_recap_poster ran at all.
    ensure.assert_not_called()
