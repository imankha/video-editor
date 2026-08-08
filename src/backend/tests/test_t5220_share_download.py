"""
T5220 -- new `GET /api/shared/{share_token}/download` endpoint (design §6,
Scope C). Today a share download does `fetch(share.video_url)` directly at
the raw presigned R2 URL and gets neither outro nor intro. This endpoint
closes that gap: it streams the SAME composed `[intro][reel][outro]` a burn
download gets, token-gated identically to `get_shared_video`.

The route does not exist yet -- these tests hit a 404 from FastAPI's router
(no matching path) until Stage 4 adds `shared_router.get("/{share_token}/download")`
in `app/routers/shares.py`. Mirrors `test_shares.py`'s `client` fixture
(TestClient over a real app, isolated Postgres `pg_conn` + tmp_path SQLite)
and its 404/410/403 gating assertions on `get_shared_video`.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

SHARER_ID = "t5220-dl-sharer"
SHARER_EMAIL = "t5220dlsharer@example.com"
RECIPIENT_ID = "t5220-dl-recipient"
RECIPIENT_EMAIL = "t5220dlrecipient@example.com"


@pytest.fixture()
def isolated_auth_db(pg_conn):
    from app.services.auth_db import create_user
    create_user(SHARER_ID, email=SHARER_EMAIL)
    create_user(RECIPIENT_ID, email=RECIPIENT_EMAIL)
    yield


@pytest.fixture()
def client(isolated_auth_db, tmp_path):
    from app.session_init import _init_cache
    _init_cache[SHARER_ID] = {"profile_id": "testdefault", "is_new_user": False}
    _init_cache[RECIPIENT_ID] = {"profile_id": "testdefault", "is_new_user": False}
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()), \
         patch("app.services.email.send_share_email", new_callable=AsyncMock, return_value=True):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _auth_headers(user_id: str) -> dict:
    return {"X-User-ID": user_id}


def _seed_final_video(user_id: str = SHARER_ID, duration: float = 12.5) -> int:
    from app.database import get_db_connection
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO final_videos (filename, name, duration, version)
               VALUES (?, ?, ?, ?)""",
            ("test-video.mp4", "Test Video", duration, 1),
        )
        conn.commit()
        return cursor.lastrowid


def _create_share(client, is_public=True, recipient_email=RECIPIENT_EMAIL) -> str:
    video_id = _seed_final_video()
    resp = client.post(
        f"/api/gallery/{video_id}/share",
        json={"recipient_emails": [recipient_email], "is_public": is_public},
        headers=_auth_headers(SHARER_ID),
    )
    return resp.json()["shares"][0]["share_token"]


# ---------------------------------------------------------------------------
# Gating parity with get_shared_video
# ---------------------------------------------------------------------------

class TestShareDownloadGating:
    def test_unknown_token_404(self, client):
        resp = client.get("/api/shared/nonexistent-token/download")
        assert resp.status_code == 404

    def test_revoked_share_410(self, client):
        token = _create_share(client, is_public=True)
        client.delete(f"/api/shared/{token}", headers=_auth_headers(SHARER_ID))
        resp = client.get(f"/api/shared/{token}/download")
        assert resp.status_code == 410

    def test_private_share_wrong_recipient_403(self, client):
        token = _create_share(client, is_public=False)
        resp = client.get(
            f"/api/shared/{token}/download",
            headers={"X-User-ID": "some-stranger"},
        )
        assert resp.status_code == 403

    def test_private_share_no_auth_403(self, client):
        token = _create_share(client, is_public=False)
        resp = client.get(f"/api/shared/{token}/download")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Happy path -- composed [intro][reel][outro] streamed
# ---------------------------------------------------------------------------

class TestShareDownloadComposition:
    def test_happy_path_streams_composed_intro_reel_outro(self, client, tmp_path):
        token = _create_share(client, is_public=True)

        composed_bytes = b"FAKE-COMPOSED-MP4-BYTES"

        def fake_compose(reel_path, out_path, *, intro=None, outro=True, metadata_hook=None):
            with open(out_path, "wb") as f:
                f.write(composed_bytes)
            return True

        with patch("app.routers.shares.generate_presigned_url_global",
                   return_value="https://r2.example.com/video.mp4"), \
             patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = mock_client_cls.return_value.__aenter__.return_value

            class _FakeStreamCtx:
                async def __aenter__(self_inner):
                    class _Resp:
                        status_code = 200
                        async def aiter_bytes(self_r, chunk_size):
                            yield b"raw-reel-bytes"
                    return _Resp()
                async def __aexit__(self_inner, *a):
                    return False

            mock_client.stream = lambda *a, **k: _FakeStreamCtx()

            with patch("app.services.serve_time_video.compose_serve_time", side_effect=fake_compose):
                resp = client.get(f"/api/shared/{token}/download")

        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("video/mp4")
        assert "attachment" in resp.headers.get("content-disposition", "")

    def test_induced_intro_failure_still_returns_200(self, client, tmp_path):
        """Non-fatal contract: an intro build failure degrades to [reel][outro]
        (or raw reel) but the download still succeeds with HTTP 200."""
        token = _create_share(client, is_public=True)

        def fake_compose_degraded(reel_path, out_path, *, intro=None, outro=True, metadata_hook=None):
            # Simulates the ladder degrading past the intro -- still produces
            # a playable file (reel + outro only).
            with open(out_path, "wb") as f:
                f.write(b"REEL-PLUS-OUTRO-ONLY")
            return True

        with patch("app.routers.shares.generate_presigned_url_global",
                   return_value="https://r2.example.com/video.mp4"), \
             patch("httpx.AsyncClient") as mock_client_cls:
            mock_client = mock_client_cls.return_value.__aenter__.return_value

            class _FakeStreamCtx:
                async def __aenter__(self_inner):
                    class _Resp:
                        status_code = 200
                        async def aiter_bytes(self_r, chunk_size):
                            yield b"raw-reel-bytes"
                    return _Resp()
                async def __aexit__(self_inner, *a):
                    return False

            mock_client.stream = lambda *a, **k: _FakeStreamCtx()

            with patch("app.services.serve_time_video.compose_serve_time",
                       side_effect=fake_compose_degraded):
                resp = client.get(f"/api/shared/{token}/download")

        assert resp.status_code == 200, "an intro-build failure must never surface as a non-200"
