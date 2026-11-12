"""T15710: the profile-mismatch 403 on GET .../poster.jpg must carry CORS headers,
driven through the REAL middleware stack (TestClient + Origin), not just the
handler in isolation.

This is the actual criterion ("posters load without CORS errors on a cold Home
load") -- a cross-origin <img> never issues a CORS preflight for a plain GET
(see test_poster_img_never_sets_cross_origin.test.jsx, which rules that half
out on the frontend), so the only way THIS endpoint could be the source of a
browser-visible "blocked by CORS" console error is if some response it can
produce were missing Access-Control-Allow-* headers. Same pattern as
test_t13440_poster_500_cors.py (which covers the unhandled-500 path); this
covers the profile-mismatch 403 path T15710 touched.
"""
from unittest.mock import patch

from fastapi.testclient import TestClient

USER = "t15710-cors-user"
PROFILE_B = "t15710-profb"
PROFILE_A = "t15710-profa"
ORIGIN = "http://localhost:5173"


def _client():
    from app.main import app
    return TestClient(app, raise_server_exceptions=False)


def test_game_poster_mismatch_403_carries_cors_headers():
    from app.session_init import _init_cache
    _init_cache[USER] = {"profile_id": PROFILE_B, "is_new_user": False}
    client = _client()
    resp = client.get(
        "/api/games/1/poster.jpg",
        params={"profile_id": PROFILE_A},
        headers={"X-User-ID": USER, "X-Profile-ID": PROFILE_B, "Origin": ORIGIN},
    )
    assert resp.status_code == 403
    assert resp.headers.get("access-control-allow-origin") == ORIGIN
    assert resp.headers.get("access-control-allow-credentials") == "true"
    assert resp.headers.get("content-type") == "image/jpeg"


def test_reel_poster_mismatch_403_carries_cors_headers():
    from app.session_init import _init_cache
    _init_cache[USER] = {"profile_id": PROFILE_B, "is_new_user": False}
    client = _client()
    resp = client.get(
        "/api/downloads/1/poster.jpg",
        params={"profile_id": PROFILE_A},
        headers={"X-User-ID": USER, "X-Profile-ID": PROFILE_B, "Origin": ORIGIN},
    )
    assert resp.status_code == 403
    assert resp.headers.get("access-control-allow-origin") == ORIGIN
    assert resp.headers.get("access-control-allow-credentials") == "true"
    assert resp.headers.get("content-type") == "image/jpeg"


def test_draft_poster_mismatch_403_carries_cors_headers():
    from app.session_init import _init_cache
    _init_cache[USER] = {"profile_id": PROFILE_B, "is_new_user": False}
    client = _client()
    with patch("app.profile_context.get_current_profile_id", return_value=PROFILE_B):
        resp = client.get(
            "/api/projects/1/poster.jpg",
            params={"profile_id": PROFILE_A},
            headers={"X-User-ID": USER, "X-Profile-ID": PROFILE_B, "Origin": ORIGIN},
        )
    assert resp.status_code == 403
    assert resp.headers.get("access-control-allow-origin") == ORIGIN
    assert resp.headers.get("access-control-allow-credentials") == "true"
    assert resp.headers.get("content-type") == "image/jpeg"
