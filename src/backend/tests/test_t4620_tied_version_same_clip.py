"""
T4620 -- a tied working-clip version resolves to the same row everywhere.

Two working_clips rows can share (project, clip identity, version). The project
list and the editor's clip endpoint must both pick the higher id; before T4620
the list's counts broke the tie by id while the shared
latest_working_clips_subquery (list clips[] + GET /projects/{id}/clips) did not.
"""

import shutil
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_t4620_tie_{uuid.uuid4().hex[:8]}"
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
    from app.user_context import reset_user_id
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID}) as c:
        yield c


def _seed_tied_project():
    """One clip identity with two version-1 rows. The lower id is untouched;
    the higher id is cropped and exported. Returns (project_id, low_id, high_id)."""
    from app.database import get_db_connection
    from app.utils.encoding import encode_data
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("T4620 Game", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        game_id = cursor.lastrowid
        cursor.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('T4620 Tie', '9:16')")
        project_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO raw_clips (filename, game_id, rating, start_time, end_time) "
            "VALUES ('tie.mp4', ?, 4, 10.0, 15.0)",
            (game_id,),
        )
        raw_clip_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) "
            "VALUES (?, ?, 1, 0)",
            (project_id, raw_clip_id),
        )
        low_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, "
            "crop_data, exported_at) VALUES (?, ?, 1, 0, ?, CURRENT_TIMESTAMP)",
            (project_id, raw_clip_id,
             encode_data([{"frame": 0, "x": 0, "y": 0, "width": 100, "height": 178}])),
        )
        high_id = cursor.lastrowid
        conn.commit()
    assert high_id > low_id
    return project_id, low_id, high_id


def test_list_and_clip_endpoint_pick_the_higher_id_on_a_tie(client):
    project_id, _low_id, high_id = _seed_tied_project()

    resp = client.get(f"/api/clips/projects/{project_id}/clips")
    assert resp.status_code == 200, resp.text
    editor_ids = [c["id"] for c in resp.json()]
    assert editor_ids == [high_id]

    resp = client.get("/api/projects")
    assert resp.status_code == 200, resp.text
    project = next(p for p in resp.json() if p["id"] == project_id)
    assert project["clip_count"] == 1
    assert project["clips"][0]["stream_clip_id"] == high_id
    # Counts describe the same (higher-id, exported + cropped) row.
    assert project["clips_exported"] == 1
    assert project["has_crop_keyframes"] is True


def test_projects_router_has_no_private_latest_clip_query():
    source = (Path(__file__).parent.parent / "app" / "routers" / "projects.py").read_text()
    assert "ORDER BY wc.version DESC" not in source
