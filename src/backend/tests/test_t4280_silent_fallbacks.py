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


def _encode_tags(tags):
    from app.utils.encoding import encode_data
    return encode_data(tags)


@pytest.fixture
def game_and_client():
    """A game row + the module-level client, context set. Used by the T10690
    NULL-rating-carried test (site coverage across clips.py + games.py)."""
    _ctx()
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO games (name, blake3_hash) VALUES ('T4280 rating', ?)",
            (f"hash_{uuid.uuid4().hex[:16]}",),
        )
        game_id = cur.lastrowid
        conn.commit()
    yield client, game_id
    with get_db_connection() as conn:
        cur = conn.cursor()
        raw_ids = [r[0] for r in cur.execute(
            "SELECT id FROM raw_clips WHERE game_id = ?", (game_id,)
        ).fetchall()]
        if raw_ids:
            placeholders = ",".join("?" for _ in raw_ids)
            cur.execute(
                f"DELETE FROM working_clips WHERE raw_clip_id IN ({placeholders})", raw_ids
            )
        cur.execute("DELETE FROM raw_clips WHERE game_id = ?", (game_id,))
        cur.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()


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


# --- #6: T10690 repealed the single-substitution rule -----------------------
# normalize_rating/UNRATED_RATING are DELETED (not just changed) -- the new
# rule is "NULL means unrated, everywhere", with three distinct explicit
# treatments at the three former call sites, not one shared coercer. See
# docs/plans/tasks/T10690-design.md § 3.A.3.

def test_normalize_rating_is_deleted():
    """The repealed helper and its constant must no longer exist -- keeping
    either around risks a caller re-importing the substitute-3 behavior."""
    import app.queries as queries_module

    assert not hasattr(queries_module, "normalize_rating")
    assert not hasattr(queries_module, "UNRATED_RATING")


def test_null_rating_is_carried_not_substituted(game_and_client):
    """The three former normalize_rating call sites (clips.py auto-project-name
    derivation, clips.py clip_list, games.py game_stats rating counts) must
    return/count None rather than inventing a 3 for an unrated clip.

    Seeds an unrated clip directly at the DB layer (RawClipCreate.rating still
    defaults to 3 today -- A.2 not yet landed -- so going through the create
    endpoint would immediately re-invent a rating; that gap is a separate,
    already-covered concern). This test isolates the three read-site
    treatments (A.3/A.4), calling the same functions the endpoints call
    rather than routing through the endpoints themselves.
    """
    client, game_id = game_and_client

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T4280', '9:16')"
        )
        project_id = cur.lastrowid
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, game_id, end_time, tags) "
            "VALUES ('', NULL, ?, 99.0, ?)",
            (game_id, _encode_tags(["Goal"])),
        )
        clip_id = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id) VALUES (?, ?)",
            (project_id, clip_id),
        )
        conn.commit()

    # Site 1: clips.py:~1090 auto-project name derivation (_create_auto_project_for_clip).
    # An unrated clip must not be silently named "Interesting Goal".
    from app.routers.clips import _create_auto_project_for_clip

    with get_db_connection() as conn:
        cur = conn.cursor()
        new_project_id = _create_auto_project_for_clip(cur, clip_id, clip_name="")
        conn.commit()
    proj_resp = client.get(f"/api/projects/{new_project_id}")
    assert proj_resp.status_code == 200, proj_resp.text
    # "Interesting" is get_rating_adjective's default for rating=3 -- the old
    # normalize_rating substitution. The unrated project name must be
    # adjective-free ("Goal"), never "Interesting Goal".
    assert proj_resp.json()["name"] == "Goal", proj_resp.json()["name"]

    # Site 2: clips.py:~1752 clip_list -- rating flows through as None, not 3.
    list_resp = client.get(f"/api/clips/projects/{project_id}/clips")
    assert list_resp.status_code == 200, list_resp.text
    clips = list_resp.json()
    by_raw_id = {c.get("raw_clip_id"): c for c in clips}
    assert clip_id in by_raw_id, clips
    assert by_raw_id[clip_id]["rating"] is None

    # Site 3: games.py:~1355 game_stats rating counts -- an unrated play must
    # not be double-counted as a 3-star ("interesting") badge.
    from app.routers.games import _compute_athlete_stats

    with get_db_connection() as conn:
        cur = conn.cursor()
        stats = _compute_athlete_stats(cur, [game_id])
    assert stats[game_id]["interesting_count"] == 0, (
        "an unrated clip must not be counted toward the 3-star ladder"
    )
