"""
T1690: Clip stream proxy must return proper HTTP errors when R2 is unavailable.

Before this fix, stream_working_clip_bounded committed to 206 + video/mp4
headers via StreamingResponse BEFORE connecting to R2. Any R2 failure produced
a broken 206 stream that browsers report as MEDIA_ERR_SRC_NOT_SUPPORTED (code=4).

The fix adds a 1-byte R2 probe (Range: bytes=0-0) before creating
StreamingResponse. If R2 returns an error, the endpoint returns a proper HTTP
error that browsers and frontend error classifiers can handle correctly.
"""

import uuid
from unittest.mock import patch, AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache

TEST_USER_ID = f"test_t1690_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture
def clip_with_game():
    """Create a working clip linked to a game with video metadata."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Create game with video metadata
        cursor.execute("""
            INSERT INTO games (name, blake3_hash, video_filename, video_duration, video_size)
            VALUES ('Test Game', 'abc123hash', 'test_game.mp4', 600.0, 1000000000)
        """)
        game_id = cursor.lastrowid

        # Create raw clip
        cursor.execute("""
            INSERT INTO raw_clips (game_id, start_time, end_time, filename, rating)
            VALUES (?, 10.0, 20.0, 'test_raw.mp4', 3)
        """, (game_id,))
        raw_clip_id = cursor.lastrowid

        # Create project
        cursor.execute("""
            INSERT INTO projects (name, aspect_ratio)
            VALUES ('Test Stream Project', '9:16')
        """)
        project_id = cursor.lastrowid

        # Create working clip linked to raw clip
        cursor.execute("""
            INSERT INTO working_clips (
                project_id, raw_clip_id, uploaded_filename, version,
                crop_data, segments_data
            )
            VALUES (?, ?, 'test_clip.mp4', 1, '[]', '{}')
        """, (project_id, raw_clip_id))
        clip_id = cursor.lastrowid

        conn.commit()

        yield project_id, clip_id

        # Cleanup
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        cursor.execute("DELETE FROM raw_clips WHERE id = ?", (raw_clip_id,))
        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()


def _make_mock_probe_response(status_code: int, content_type: str = "application/xml", body: str = ""):
    """Create a mock httpx response for the R2 probe."""
    resp = AsyncMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.text = body
    resp.headers = {"content-type": content_type}
    return resp


class TestClipStreamR2Probe:
    """Verify the R2 probe catches errors before committing to 206 headers."""

    def test_r2_404_returns_proper_404(self, clip_with_game):
        """When R2 returns 404 (file missing), endpoint returns 404 — not broken 206."""
        project_id, clip_id = clip_with_game

        mock_probe_resp = _make_mock_probe_response(
            404, body='<?xml version="1.0"?><Error><Code>NoSuchKey</Code></Error>'
        )

        with patch("app.routers.games.get_game_video_url", return_value="https://r2.example.com/fake"):
            with patch("httpx.AsyncClient.__aenter__") as mock_client_ctx:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=mock_probe_resp)
                mock_client_ctx.return_value = mock_client

                r = client.get(
                    f"/api/clips/projects/{project_id}/clips/{clip_id}/stream",
                    headers={"Range": "bytes=0-1023"},
                )

        assert r.status_code == 404, (
            f"R2 404 should produce HTTP 404, got {r.status_code}: {r.text}"
        )

    def test_r2_403_returns_proper_403(self, clip_with_game):
        """When R2 returns 403 (expired presigned URL), endpoint returns 403."""
        project_id, clip_id = clip_with_game

        mock_probe_resp = _make_mock_probe_response(
            403, body='<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>'
        )

        with patch("app.routers.games.get_game_video_url", return_value="https://r2.example.com/fake"):
            with patch("httpx.AsyncClient.__aenter__") as mock_client_ctx:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=mock_probe_resp)
                mock_client_ctx.return_value = mock_client

                r = client.get(
                    f"/api/clips/projects/{project_id}/clips/{clip_id}/stream",
                    headers={"Range": "bytes=0-1023"},
                )

        assert r.status_code == 403, (
            f"R2 403 should produce HTTP 403, got {r.status_code}: {r.text}"
        )

    def test_r2_500_returns_502(self, clip_with_game):
        """When R2 returns 500 (outage), endpoint returns 502 Bad Gateway."""
        project_id, clip_id = clip_with_game

        mock_probe_resp = _make_mock_probe_response(
            500, body="Internal Server Error"
        )

        with patch("app.routers.games.get_game_video_url", return_value="https://r2.example.com/fake"):
            with patch("httpx.AsyncClient.__aenter__") as mock_client_ctx:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=mock_probe_resp)
                mock_client_ctx.return_value = mock_client

                r = client.get(
                    f"/api/clips/projects/{project_id}/clips/{clip_id}/stream",
                    headers={"Range": "bytes=0-1023"},
                )

        assert r.status_code == 502, (
            f"R2 500 should produce HTTP 502, got {r.status_code}: {r.text}"
        )
