"""
T8350 — multi-clip reel staleness: the projects-list `ClipSummary` fields the
frontend badge/segment-tint/Focus-dot are derived from.

This does NOT re-derive the staleness comparison rule (that's T8070's, reused
byte-identically by the frontend's isClipStale) -- it locks the NEW backend
surface T8350 adds: GET /api/projects (ClipSummary in project.clips[]) now
carries each clip's live start_time/end_time alongside its reel_source_*
snapshot, so the frontend can compute staleness without an extra fetch.

Harness mirrors test_t8070_reel_source_window.py (real per-user SQLite via
TestClient). The below-head (pre-v049) column_exists degrade path is covered
by test_projects_list in test_t6030_migration_window_structural_guard.py.
"""

import shutil
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_t8350_projects_list_{uuid.uuid4().hex[:8]}"
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
            ("T8350 Staleness Game", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        conn.commit()
        return cursor.lastrowid


def _seed_multiclip_project(client, game_id, clip_windows):
    """A project with N raw_clips (each given a produced reel_source snapshot
    equal to its initial start/end) linked as the LATEST working_clips row.
    Returns (project_id, [raw_clip_id, ...])."""
    from app.database import get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO projects (name, aspect_ratio) VALUES (?, '9:16')",
                        (f"T8350 Project {uuid.uuid4().hex[:6]}",))
        project_id = cursor.lastrowid

        raw_clip_ids = []
        for sort_order, (start, end) in enumerate(clip_windows):
            cursor.execute(
                "INSERT INTO raw_clips (filename, game_id, rating, start_time, end_time, "
                "reel_source_start_time, reel_source_end_time) VALUES (?, ?, 4, ?, ?, ?, ?)",
                (f"clip{sort_order}.mp4", game_id, start, end, start, end),
            )
            raw_clip_id = cursor.lastrowid
            raw_clip_ids.append(raw_clip_id)
            cursor.execute(
                "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) "
                "VALUES (?, ?, 1, ?)",
                (project_id, raw_clip_id, sort_order),
            )
        conn.commit()
    return project_id, raw_clip_ids


def _clip_summaries(client, project_id):
    resp = client.get("/api/projects")
    assert resp.status_code == 200
    project = next(p for p in resp.json() if p["id"] == project_id)
    return {c["id"]: c for c in project["clips"]}


def test_clip_summary_carries_live_and_snapshot_fields(client, game_id):
    """A freshly-produced multi-clip reel: live boundaries equal the snapshot
    for every clip (not stale), and both are present on the payload."""
    project_id, raw_clip_ids = _seed_multiclip_project(
        client, game_id, [(5.0, 10.0), (20.0, 24.0)]
    )
    clips = _clip_summaries(client, project_id)

    for raw_clip_id, (start, end) in zip(raw_clip_ids, [(5.0, 10.0), (20.0, 24.0)]):
        summary = clips[raw_clip_id]
        assert summary["start_time"] == start
        assert summary["end_time"] == end
        assert summary["reel_source_start_time"] == start
        assert summary["reel_source_end_time"] == end


def test_drifted_clip_diverges_from_snapshot_sibling_unaffected(client, game_id):
    """Editing ONE clip's boundaries moves its live start_time away from its
    frozen reel_source_* on the projects-list payload; the OTHER clip in the
    same reel is untouched -- the per-clip granularity the tile/segment/Focus
    cues depend on."""
    project_id, raw_clip_ids = _seed_multiclip_project(
        client, game_id, [(30.0, 35.0), (40.0, 45.0)]
    )
    drifted_id, stable_id = raw_clip_ids

    resp = client.put(f"/api/clips/raw/{drifted_id}", json={"start_time": 31.5, "end_time": 35.0})
    assert resp.status_code == 200

    clips = _clip_summaries(client, project_id)

    drifted = clips[drifted_id]
    assert drifted["start_time"] == 31.5
    assert drifted["reel_source_start_time"] == 30.0  # snapshot frozen -> stale by comparison

    stable = clips[stable_id]
    assert stable["start_time"] == stable["reel_source_start_time"] == 40.0
    assert stable["end_time"] == stable["reel_source_end_time"] == 45.0


def test_revert_to_exact_producing_values_matches_snapshot_again(client, game_id):
    """Reverting a drifted clip to the EXACT values it was produced from makes
    the live/snapshot pair equal again on the payload -- the read-time state
    isClipStale needs to clear the cue with no write of its own."""
    project_id, raw_clip_ids = _seed_multiclip_project(
        client, game_id, [(50.0, 55.0)]
    )
    (clip_id,) = raw_clip_ids

    client.put(f"/api/clips/raw/{clip_id}", json={"start_time": 51.0, "end_time": 55.0})
    drifted = _clip_summaries(client, project_id)[clip_id]
    assert drifted["start_time"] != drifted["reel_source_start_time"]

    client.put(f"/api/clips/raw/{clip_id}", json={"start_time": 50.0, "end_time": 55.0})
    reverted = _clip_summaries(client, project_id)[clip_id]
    assert reverted["start_time"] == reverted["reel_source_start_time"] == 50.0
    assert reverted["end_time"] == reverted["reel_source_end_time"] == 55.0


def test_never_produced_clip_has_null_snapshot_on_payload(client, game_id):
    """A clip in a project that was never produced (no export yet) has a NULL
    reel_source_* snapshot -- not-null guard on the payload, not just the DB row."""
    project_id, raw_clip_ids = _seed_multiclip_project(client, game_id, [])
    from app.database import get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO raw_clips (filename, game_id, rating, start_time, end_time) "
            "VALUES ('unproduced.mp4', ?, 3, 60.0, 65.0)",
            (game_id,),
        )
        raw_clip_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) "
            "VALUES (?, ?, 1, 0)",
            (project_id, raw_clip_id),
        )
        conn.commit()

    summary = _clip_summaries(client, project_id)[raw_clip_id]
    assert summary["start_time"] == 60.0
    assert summary["end_time"] == 65.0
    assert summary["reel_source_start_time"] is None
    assert summary["reel_source_end_time"] is None
