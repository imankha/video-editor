"""
T4280 regression tests: backend silent-fallback sweep. Each listed site must fail
visibly (422/400, raise, or ERROR log + safe value) instead of silently substituting a
default for internal data. Each site gets a failure test and a happy-path test.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache

TEST_USER_ID = f"test_t4280_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}
client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


def _ctx():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


# --- #1: no fabricated crop geometry ----------------------------------------

@pytest.fixture
def clip():
    _ctx()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('T4280', '9:16')")
        pid = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, uploaded_filename, version, crop_data, segments_data) "
            "VALUES (?, 'c.mp4', 1, NULL, NULL)",
            (pid,),
        )
        cid = cur.lastrowid
        conn.commit()
    yield pid, cid
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM working_clips WHERE project_id = ?", (pid,))
        cur.execute("DELETE FROM projects WHERE id = ?", (pid,))
        conn.commit()


def _add_kf(pid, cid, data):
    return client.post(
        f"/api/clips/projects/{pid}/clips/{cid}/actions",
        json={"action": "add_crop_keyframe", "data": data},
    )


def test_add_keyframe_missing_geometry_is_rejected(clip):
    pid, cid = clip
    resp = _add_kf(pid, cid, {"frame": 0, "x": 10, "y": 20, "height": 200, "origin": "user"})  # no width
    assert resp.status_code == 400, resp.text
    assert "width" in resp.json().get("error", "")
    # Nothing was persisted.
    with get_db_connection() as conn:
        row = conn.cursor().execute("SELECT crop_data FROM working_clips WHERE id = ?", (cid,)).fetchone()
    assert row["crop_data"] is None


def test_add_keyframe_happy_path_stores_exact_geometry(clip):
    pid, cid = clip
    resp = _add_kf(pid, cid, {"frame": 0, "x": 0, "y": 0, "width": 640, "height": 360, "origin": "user"})
    assert resp.status_code == 200, resp.text
    from app.utils.encoding import decode_data
    with get_db_connection() as conn:
        row = conn.cursor().execute("SELECT crop_data FROM working_clips WHERE id = ?", (cid,)).fetchone()
    kf = decode_data(row["crop_data"])[0]
    # x=0 is preserved (checked for None, not falsiness).
    assert (kf["x"], kf["y"], kf["width"], kf["height"]) == (0, 0, 640, 360)


# --- #2: NULL game status is surfaced, not defaulted to 'ready' --------------

def test_game_status_helper_surfaces_null_and_trusts_value(caplog):
    from app.routers.games import _game_status_or_log
    import logging

    with caplog.at_level(logging.ERROR):
        assert _game_status_or_log(None, 99) is None  # surfaced, not 'ready'
    assert any("NULL status" in r.message for r in caplog.records)
    assert _game_status_or_log("ready", 1) == "ready"  # happy path unchanged


def test_get_games_route_binds_list_games():
    """Guard: the _game_status_or_log helper must NOT sit under the @router.get('')
    decorator (that would register the helper as the endpoint and break GET /api/games)."""
    get_games = [
        r for r in app.routes
        if getattr(r, "path", "") == "/api/games" and "GET" in getattr(r, "methods", set())
    ]
    assert get_games, "GET /api/games route missing"
    assert get_games[0].endpoint.__name__ == "list_games"


# --- #3: unparseable expiry -> EXPIRED (safe direction) ----------------------

def test_storage_status_unparseable_expiry_is_expired(caplog):
    from app.routers.games import _compute_storage_status
    import logging

    with caplog.at_level(logging.ERROR):
        assert _compute_storage_status("not-a-date", None) == "expired"
    assert any("Unparseable" in r.message for r in caplog.records)
    # Happy path: a clearly future date is active.
    assert _compute_storage_status("2999-01-01T00:00:00", None) == "active"


# --- #5: get_video_duration raises on a bad file ----------------------------

def test_get_video_duration_raises_on_bad_file():
    from app.services.ffmpeg_service import get_video_duration
    with pytest.raises(RuntimeError):
        get_video_duration("/nonexistent/definitely-not-a-video.mp4")


# --- #4: local processor raises on probe failure ----------------------------

def test_local_processor_raises_on_probe_failure(tmp_path):
    from app.services.local_processors import MockVideoUpscaler
    up = MockVideoUpscaler()
    with pytest.raises(RuntimeError):
        up.process_video_with_upscale(
            input_path="/nonexistent/bad.mp4",
            output_path=str(tmp_path / "out.mp4"),
            keyframes=[{"x": 0, "y": 0, "width": 1, "height": 1}],
        )


# --- #6: one NULL-rating helper, used everywhere ----------------------------

def test_normalize_rating_single_semantics(caplog):
    from app.queries import normalize_rating, UNRATED_RATING
    import logging

    with caplog.at_level(logging.ERROR):
        assert normalize_rating(None, context="t") == UNRATED_RATING  # logged fallback
    assert any("NULL rating" in r.message for r in caplog.records)
    # Real values (including an unexpected 0) are trusted, not overridden.
    assert normalize_rating(5) == 5
    assert normalize_rating(0) == 0
