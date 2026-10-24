"""
T3250: Direct R2 streaming -- playback-url endpoint tests.

These tests cover two new endpoints that return presigned R2 URLs for
direct browser playback, replacing the proxy-based streaming approach:

  GET /api/games/{game_id}/playback-url
  GET /api/clips/projects/{project_id}/clips/{clip_id}/playback-url

Tests are written BEFORE the endpoints exist (test-first). They will fail
with 404 / "Method Not Allowed" until the implementation is added.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache

TEST_USER_ID = f"test_t3250_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})
unauth_client = TestClient(app)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def game_with_clip():
    """Create a game with blake3_hash, linked raw_clip, project, and working_clip."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO games (name, blake3_hash, video_filename, video_duration, video_size)
            VALUES ('Test Game', 'abc123hash', 'test_game.mp4', 600.0, 1000000000)
        """)
        game_id = cursor.lastrowid

        # T8310/T8320: a real LIVE hash-backed game ALWAYS has a game_storage row
        # with a future expiry (written at upload; backfilled for legacy games by
        # v017/v047). Without it, _compute_storage_status(has_hash=True, no
        # row) correctly reports 'expired' and the T8310 clip-playback gate 410s
        # before the R2 code paths these tests exercise. This row makes the
        # fixture a genuine non-expired game (status 'active'). DO NOT REMOVE.
        cursor.execute(
            """INSERT OR REPLACE INTO game_storage
               (blake3_hash, game_size_bytes, storage_expires_at)
               VALUES (?, ?, ?)""",
            ('abc123hash', 1000000000,
             (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()),
        )

        cursor.execute("""
            INSERT INTO raw_clips (game_id, start_time, end_time, filename, rating)
            VALUES (?, 10.0, 20.0, 'test_raw.mp4', 3)
        """, (game_id,))
        raw_clip_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES ('Test Project', '9:16')
        """)
        project_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_clips (project_id, raw_clip_id, uploaded_filename, version, crop_data, segments_data)
            VALUES (?, ?, 'test_clip.mp4', 1, '[]', '{}')
        """, (project_id, raw_clip_id))
        clip_id = cursor.lastrowid

        conn.commit()

        yield game_id, project_id, clip_id

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        cursor.execute("DELETE FROM raw_clips WHERE id = ?", (raw_clip_id,))
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        cursor.execute("DELETE FROM game_storage WHERE blake3_hash = 'abc123hash'")
        conn.commit()


@pytest.fixture
def game_no_hash():
    """Create a game WITHOUT blake3_hash, plus linked clip chain for clip-level tests."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()

        cursor.execute("""
            INSERT INTO games (name, blake3_hash, video_filename, video_duration, video_size)
            VALUES ('No Hash Game', NULL, 'no_hash.mp4', 300.0, 500000)
        """)
        game_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO raw_clips (game_id, start_time, end_time, filename, rating)
            VALUES (?, 5.0, 15.0, 'no_hash_clip.mp4', 3)
        """, (game_id,))
        raw_clip_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES ('No Hash Project', '9:16')
        """)
        project_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO working_clips (project_id, raw_clip_id, uploaded_filename, version, crop_data, segments_data)
            VALUES (?, ?, 'no_hash_clip.mp4', 1, '[]', '{}')
        """, (project_id, raw_clip_id))
        clip_id = cursor.lastrowid

        conn.commit()

        yield game_id, project_id, clip_id

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        cursor.execute("DELETE FROM raw_clips WHERE id = ?", (raw_clip_id,))
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()


# ---------------------------------------------------------------------------
# Game playback-url endpoint
# ---------------------------------------------------------------------------

class TestGamePlaybackUrl:
    """GET /api/games/{game_id}/playback-url"""

    def test_game_playback_url_returns_presigned_url(self, game_with_clip):
        """Successful request returns presigned URL with metadata."""
        game_id, _, _ = game_with_clip

        with patch(
            "app.routers.games.get_game_video_url",
            return_value="https://r2.example.com/games/abc123hash.mp4?sig=test",
        ):
            r = client.get(f"/api/games/{game_id}/playback-url")

        assert r.status_code == 200, (
            f"expected 200, got {r.status_code}: {r.text}"
        )
        body = r.json()
        assert "url" in body, "response must include 'url'"
        assert body["url"].startswith("https://"), "url must be an HTTPS presigned URL"
        assert "expires_in" in body, "response must include 'expires_in'"
        assert body["expires_in"] > 0, "expires_in must be positive"
        assert "file_size" in body, "response must include 'file_size'"
        assert body["file_size"] == 1000000000, (
            f"file_size should match game's video_size, got {body['file_size']}"
        )

    def test_game_playback_url_not_found(self):
        """Non-existent game_id returns 404."""
        r = client.get("/api/games/999999/playback-url")
        assert r.status_code == 404, (
            f"expected 404 for non-existent game, got {r.status_code}: {r.text}"
        )

    def test_game_playback_url_missing_hash(self, game_no_hash):
        """Game without blake3_hash returns 422 -- cannot construct R2 key."""
        game_id, _, _ = game_no_hash

        r = client.get(f"/api/games/{game_id}/playback-url")
        assert r.status_code == 422, (
            f"expected 422 for game missing blake3_hash, got {r.status_code}: {r.text}"
        )

    def test_game_playback_url_r2_failure(self, game_with_clip):
        """When R2 presign fails (returns None), endpoint returns 502."""
        game_id, _, _ = game_with_clip

        with patch("app.routers.games.get_game_video_url", return_value=None):
            r = client.get(f"/api/games/{game_id}/playback-url")

        assert r.status_code == 502, (
            f"expected 502 when R2 presign fails, got {r.status_code}: {r.text}"
        )

    def test_game_playback_url_requires_auth(self):
        """Request without auth headers returns 401."""
        r = unauth_client.get("/api/games/1/playback-url", headers={})
        assert r.status_code == 401, (
            f"expected 401 for unauthenticated request, got {r.status_code}: {r.text}"
        )


# ---------------------------------------------------------------------------
# Clip playback-url endpoint
# ---------------------------------------------------------------------------

class TestClipPlaybackUrl:
    """GET /api/clips/projects/{project_id}/clips/{clip_id}/playback-url"""

    def test_clip_playback_url_returns_presigned_url(self, game_with_clip):
        """Successful request returns presigned URL with clip timing metadata."""
        _, project_id, clip_id = game_with_clip

        with patch(
            "app.routers.games.get_game_video_url",
            return_value="https://r2.example.com/games/abc123hash.mp4?sig=test",
        ):
            r = client.get(
                f"/api/clips/projects/{project_id}/clips/{clip_id}/playback-url"
            )

        assert r.status_code == 200, (
            f"expected 200, got {r.status_code}: {r.text}"
        )
        body = r.json()
        assert "url" in body, "response must include 'url'"
        assert body["url"].startswith("https://"), "url must be an HTTPS presigned URL"
        assert "expires_in" in body, "response must include 'expires_in'"
        assert body["expires_in"] > 0, "expires_in must be positive"
        assert "file_size" in body, "response must include 'file_size'"
        assert body["file_size"] == 1000000000, (
            f"file_size should match game's video_size, got {body['file_size']}"
        )
        assert "start_time" in body, "response must include 'start_time'"
        assert body["start_time"] == 10.0, (
            f"start_time should be 10.0, got {body['start_time']}"
        )
        assert "end_time" in body, "response must include 'end_time'"
        assert body["end_time"] == 20.0, (
            f"end_time should be 20.0, got {body['end_time']}"
        )

    def test_clip_playback_url_not_found(self):
        """Non-existent clip returns 404."""
        r = client.get("/api/clips/projects/999999/clips/999999/playback-url")
        assert r.status_code == 404, (
            f"expected 404 for non-existent clip, got {r.status_code}: {r.text}"
        )

    def test_clip_playback_url_missing_hash(self, game_no_hash):
        """Clip whose game lacks blake3_hash returns 422."""
        _, project_id, clip_id = game_no_hash

        r = client.get(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/playback-url"
        )
        assert r.status_code == 422, (
            f"expected 422 for clip with missing blake3_hash, got {r.status_code}: {r.text}"
        )

    def test_clip_playback_url_r2_failure(self, game_with_clip):
        """When R2 presign fails (returns None), endpoint returns 502."""
        _, project_id, clip_id = game_with_clip

        with patch("app.routers.games.get_game_video_url", return_value=None):
            r = client.get(
                f"/api/clips/projects/{project_id}/clips/{clip_id}/playback-url"
            )

        assert r.status_code == 502, (
            f"expected 502 when R2 presign fails, got {r.status_code}: {r.text}"
        )

    def test_clip_playback_url_requires_auth(self):
        """Request without auth headers returns 401."""
        r = unauth_client.get(
            "/api/clips/projects/1/clips/1/playback-url", headers={}
        )
        assert r.status_code == 401, (
            f"expected 401 for unauthenticated request, got {r.status_code}: {r.text}"
        )


# ---------------------------------------------------------------------------
# T13150: a linked upload clip plays its OWN file, not the game video
# ---------------------------------------------------------------------------

def test_t13150_linked_upload_clip_playback_url_is_own_file(game_with_clip):
    """T13150:C2 - raw_clips.source='upload' + game_id set -> raw_clips/{filename},
    range 0..duration, never games/{hash}.mp4."""
    game_id, project_id, clip_id = game_with_clip
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE raw_clips SET source='upload', start_time=0, end_time=20.0, "
            "filename='own_clip.mp4' WHERE game_id = ?", (game_id,))
        conn.commit()

    with patch("app.routers.games.generate_presigned_url_global", return_value="GAME_URL"), \
         patch("app.storage.generate_presigned_url", return_value="OWN_URL") as own:
        resp = client.get(f"/api/clips/projects/{project_id}/clips/{clip_id}/playback-url")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["url"] == "OWN_URL"
    assert (body["start_time"], body["end_time"]) == (0, 20.0)
    assert own.call_args.kwargs.get("relative_path", own.call_args.args[1] if len(own.call_args.args) > 1 else None) == "raw_clips/own_clip.mp4"


# ---------------------------------------------------------------------------
# T13300: remaining game-source paths for a linked upload clip
# ---------------------------------------------------------------------------

def _null_clip_blobs(project_id):
    # The shared fixture stores crop/segments as str; the list endpoint decodes bytes.
    with get_db_connection() as conn:
        conn.execute("UPDATE working_clips SET crop_data=NULL, segments_data=NULL "
                     "WHERE project_id = ?", (project_id,))
        conn.commit()


def _link_upload(game_id):
    with get_db_connection() as conn:
        conn.execute(
            "UPDATE raw_clips SET source='upload', start_time=0, end_time=20.0, "
            "filename='own_clip.mp4' WHERE game_id = ?", (game_id,))
        conn.commit()


def test_t13300_source_confirmed_unavailable_ignores_game_for_upload_clip():
    """T13300:C1 - own file gone + game still present -> source-unavailable for a
    linked upload clip (the game probe must be skipped)."""
    from app.services.export_helpers import source_confirmed_unavailable
    set_current_user_id(TEST_USER_ID)
    clip = {
        "id": 1, "game_id": 7, "source": "upload", "raw_filename": "own_clip.mp4",
        "game_blake3_hash": "deadbeef" * 4,
    }
    with patch("app.storage.r2_head_object_global", return_value={"ContentLength": 1}), \
         patch("app.storage.file_exists_in_r2", return_value=False):
        assert source_confirmed_unavailable(clip) is True


def test_t13300_list_clips_has_no_game_video_url_for_upload_clip(game_with_clip):
    """T13300:C2 - working-clips list carries no game video URL for source='upload'."""
    game_id, project_id, _clip_id = game_with_clip
    _link_upload(game_id)
    _null_clip_blobs(project_id)
    with patch("app.routers.games.generate_presigned_url_global", return_value="GAME_URL"):
        resp = client.get(f"/api/clips/projects/{project_id}/clips")
    assert resp.status_code == 200, resp.text
    clips = resp.json()
    assert clips and clips[0]["game_video_url"] is None
    # Focus still loads it: the frontend falls through to the clip's own file.
    assert clips[0]["filename"] == "own_clip.mp4"


def test_t13300_list_clips_keeps_game_video_url_for_game_clip(game_with_clip):
    """T13300:C2 (guard) - a real game clip still gets its game video URL."""
    _game_id, project_id, _clip_id = game_with_clip
    _null_clip_blobs(project_id)
    with patch("app.routers.games.generate_presigned_url_global", return_value="GAME_URL"):
        resp = client.get(f"/api/clips/projects/{project_id}/clips")
    assert resp.status_code == 200, resp.text
    assert resp.json()[0]["game_video_url"] == "GAME_URL"


def test_t13300_stream_for_upload_clip_never_serves_game_bytes(game_with_clip):
    """T13300:C3 - /stream for a linked upload clip redirects to its own file."""
    game_id, project_id, clip_id = game_with_clip
    _link_upload(game_id)
    with patch("app.routers.games.generate_presigned_url_global", return_value="GAME_URL") as game, \
         patch("app.storage.generate_presigned_url", return_value="OWN_URL"):
        resp = client.get(
            f"/api/clips/projects/{project_id}/clips/{clip_id}/stream",
            follow_redirects=False)
    assert resp.status_code == 302, resp.text
    assert resp.headers["location"] == "OWN_URL"
    game.assert_not_called()


def test_t13300_framing_export_gate_skips_linked_upload_clip(game_with_clip):
    """T13300 - the pre-export reclaimed-source gate (exports.py) must not consider
    a linked upload clip's game; it plays its own file. The gate runs before
    keyframe parsing, so reaching the 400 'No keyframes' proves it passed."""
    from app.routers.games import GameSourceExpired
    game_id, project_id, _clip_id = game_with_clip
    _link_upload(game_id)
    with patch("app.routers.games.assert_clip_source_available",
               side_effect=GameSourceExpired(game_id, False)) as gate:
        resp = client.post(
            "/api/exports/framing",
            data={"project_id": project_id, "keyframes_json": "[]"},
            files={"video": ("v.mp4", b"x", "video/mp4")},
        )
    assert resp.status_code == 400, resp.text
    assert "keyframes" in resp.text.lower()
    gate.assert_not_called()
