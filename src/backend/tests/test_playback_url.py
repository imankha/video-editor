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
