"""T13440: an unhandled 500 on the reel poster route must still carry CORS headers.

Starlette routes `@app.exception_handler(Exception)` to ServerErrorMiddleware, which
sits OUTSIDE CORSMiddleware, so a crash (e.g. an httpx timeout talking to R2) reached
a cross-origin <img> as "No Access-Control-Allow-Origin" + net::ERR_FAILED instead of a
plain 500 the tile can fall back from.
"""
from unittest.mock import patch

from fastapi.testclient import TestClient

USER = "t13440-user"
PROFILE = "cccc3333"
ORIGIN = "http://localhost:5173"


def test_unhandled_error_on_poster_route_carries_cors_headers(tmp_path):
    from app.session_init import _init_cache
    _init_cache[USER] = {"profile_id": PROFILE, "is_new_user": False}
    patchers = [
        patch("app.database.USER_DATA_BASE", tmp_path),
        patch("app.services.user_db.USER_DATA_BASE", tmp_path),
        patch("app.services.user_db._initialized_user_dbs", set()),
    ]
    for p in patchers:
        p.start()
    try:
        from app.database import get_db_connection
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id
        set_current_user_id(USER)
        set_current_profile_id(PROFILE)
        with get_db_connection() as conn:
            conn.execute("INSERT INTO final_videos (id, filename) VALUES (1, 'reel_1.mp4')")
            conn.commit()

        from app.main import app
        client = TestClient(app, raise_server_exceptions=False)
        with patch("app.routers.downloads.profile_object_exists",
                   side_effect=RuntimeError("r2 boom")):
            resp = client.get(
                "/api/downloads/1/poster.jpg",
                headers={"X-User-ID": USER, "X-Profile-ID": PROFILE, "Origin": ORIGIN},
            )
        assert resp.status_code == 500
        assert resp.headers.get("access-control-allow-origin") == ORIGIN
        assert resp.headers.get("access-control-allow-credentials") == "true"
    finally:
        for p in patchers:
            p.stop()
