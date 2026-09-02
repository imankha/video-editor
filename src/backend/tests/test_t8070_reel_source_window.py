"""
T8070 — reel-source window: seed at reel creation, the load-bearing invariant
that a boundary edit NEVER touches the snapshot (so revert-to-exact restores
validity), and the two read surfaces that expose it per-clip.

Harness mirrors test_create_reel_toggle.py (real per-user SQLite via TestClient).

Written test-first (Stage 3): expected to FAIL until the write/read sites land.
"""

import shutil
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_t8070_window_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

from app.session_init import _init_cache  # noqa: E402

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def setup_module():
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.profile_context import set_current_profile_id
    from app.user_context import reset_user_id, set_current_user_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id("testdefault")
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": "testdefault"}) as c:
        yield c


@pytest.fixture
def game_id(client):
    from app.database import get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("T8070 Window Game", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        conn.commit()
        return cursor.lastrowid


def _reel_source(clip_id):
    from app.database import get_db_connection
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT start_time, end_time, reel_source_start_time, reel_source_end_time "
            "FROM raw_clips WHERE id = ?",
            (clip_id,),
        ).fetchone()
    return row


def _create_clip_with_reel(client, game_id, start, end):
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": start,
        "end_time": end,
        "rating": 4,
        "create_project": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_created"] is True
    return data["raw_clip_id"], data["project_id"]


# ------------------------------------------------------------------- seed ----

def test_create_reel_seeds_reel_source_window(client, game_id):
    """Creating a reel snapshots the clip's CURRENT boundaries into reel_source_*."""
    clip_id, _ = _create_clip_with_reel(client, game_id, 3.0, 9.5)
    row = _reel_source(clip_id)
    assert row["reel_source_start_time"] == 3.0
    assert row["reel_source_end_time"] == 9.5


# --------------------------------------------------- INV-1 + revert-to-exact -

def test_boundary_edit_does_not_touch_snapshot(client, game_id):
    """The load-bearing invariant: editing start/end via update_raw_clip leaves
    reel_source_* frozen (the producing window stays fixed until the next export)."""
    clip_id, _ = _create_clip_with_reel(client, game_id, 10.0, 15.0)
    assert _reel_source(clip_id)["reel_source_start_time"] == 10.0

    resp = client.put(f"/api/clips/raw/{clip_id}", json={"start_time": 11.0, "end_time": 16.0})
    assert resp.status_code == 200

    row = _reel_source(clip_id)
    assert row["start_time"] == 11.0 and row["end_time"] == 16.0       # live boundaries moved
    assert row["reel_source_start_time"] == 10.0                        # snapshot frozen
    assert row["reel_source_end_time"] == 15.0


def test_revert_to_exact_values_restores_equality(client, game_id):
    """After drifting then reverting to the EXACT producing values, the live
    boundaries equal the frozen snapshot again (pure value comparison)."""
    clip_id, _ = _create_clip_with_reel(client, game_id, 20.0, 25.0)

    client.put(f"/api/clips/raw/{clip_id}", json={"start_time": 22.0, "end_time": 27.0})
    drifted = _reel_source(clip_id)
    assert drifted["start_time"] != drifted["reel_source_start_time"]   # stale now

    client.put(f"/api/clips/raw/{clip_id}", json={"start_time": 20.0, "end_time": 25.0})
    reverted = _reel_source(clip_id)
    assert reverted["start_time"] == reverted["reel_source_start_time"]  # restored
    assert reverted["end_time"] == reverted["reel_source_end_time"]
    # and the snapshot itself never moved throughout
    assert reverted["reel_source_start_time"] == 20.0
    assert reverted["reel_source_end_time"] == 25.0


def test_metadata_only_edit_does_not_touch_snapshot(client, game_id):
    """A pure metadata edit (rating/name) obviously must not touch reel_source_*."""
    clip_id, _ = _create_clip_with_reel(client, game_id, 30.0, 35.0)
    client.put(f"/api/clips/raw/{clip_id}", json={"rating": 5, "name": "Renamed"})
    row = _reel_source(clip_id)
    assert row["reel_source_start_time"] == 30.0
    assert row["reel_source_end_time"] == 35.0


# --------------------------------------------------------------- surfaces ----

def test_surface_b_working_clip_response_exposes_reel_source(client, game_id):
    """GET /projects/{id}/clips (WorkingClipResponse) carries the per-clip snapshot
    — the surface a multi-clip staleness cue will consume."""
    clip_id, project_id = _create_clip_with_reel(client, game_id, 40.0, 46.0)
    resp = client.get(f"/api/clips/projects/{project_id}/clips")
    assert resp.status_code == 200
    clips = resp.json()
    assert len(clips) == 1
    assert clips[0]["reel_source_start_time"] == 40.0
    assert clips[0]["reel_source_end_time"] == 46.0


def test_surface_a_annotate_load_exposes_reel_source(client, game_id):
    """load_annotations_from_db (the annotate /load path) emits reel_source_* on
    each region so ClipDetailsEditor can compare per-clip."""
    from app.routers.games import load_annotations_from_db
    clip_id, _ = _create_clip_with_reel(client, game_id, 50.0, 55.0)

    annotations = load_annotations_from_db(game_id)
    mine = next(a for a in annotations if a["id"] == clip_id)
    assert mine["reel_source_start_time"] == 50.0
    assert mine["reel_source_end_time"] == 55.0


def test_no_reel_clip_has_null_snapshot(client, game_id):
    """A clip saved WITHOUT create_project has no reel and a NULL snapshot — the
    legitimately-different 'no reel' meaning, handled by the frontend hasReel gate."""
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 60.0,
        "end_time": 65.0,
        "rating": 3,
    })
    clip_id = resp.json()["raw_clip_id"]
    row = _reel_source(clip_id)
    assert row["reel_source_start_time"] is None
    assert row["reel_source_end_time"] is None
