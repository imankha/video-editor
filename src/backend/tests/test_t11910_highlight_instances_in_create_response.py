"""
T11910 -- create/update responses carry the play's FULL highlight_instances list.

Bug: the client only learned the new project id from a create, so a play's
highlight collection stayed [] until the game was reloaded (UI differed
immediately after creating vs after reload). Contract under test: every
response that can change a play's highlights returns the SAME serializer output
the load path uses (`_get_highlight_instances_by_clip`), so the client replaces
its list instead of guessing.

Real DB via TestClient (mirrors tests/test_t11430_highlight_creation.py).
"""

import shutil
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.session_init import _init_cache

TEST_USER_ID = f"test_t11910_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

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
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


@pytest.fixture(scope="module")
def client():
    with TestClient(app, headers={"X-User-ID": TEST_USER_ID, "X-Profile-ID": TEST_PROFILE_ID}) as c:
        yield c


@pytest.fixture
def game_id():
    from app.database import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("T11910 Game", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        conn.commit()
        return cursor.lastrowid


def _loaded_instances(raw_clip_id):
    """What a reload would hand the client for this play."""
    from app.database import get_db_connection
    from app.routers.clips import _get_highlight_instances_by_clip

    with get_db_connection() as conn:
        return _get_highlight_instances_by_clip(conn.cursor(), [raw_clip_id]).get(raw_clip_id, [])


def _save(client, game_id, **extra):
    body = {"game_id": game_id, "start_time": 1.0, "end_time": 6.0, "rating": 5, **extra}
    resp = client.post("/api/clips/raw/save", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_save_with_create_project_returns_loaded_instances(client, game_id):
    data = _save(client, game_id, create_project=True)
    assert data["project_created"] is True
    assert len(data["highlight_instances"]) == 1
    assert data["highlight_instances"] == _loaded_instances(data["raw_clip_id"])
    assert data["highlight_instances"][0]["project_id"] == data["project_id"]


def test_save_without_create_project_returns_empty_list(client, game_id):
    data = _save(client, game_id)
    assert data["highlight_instances"] == []


def test_save_with_landscape_creates_landscape_instance(client, game_id):
    """First create on a not-yet-saved play must be able to pick Landscape."""
    data = _save(client, game_id, create_project=True, aspect_ratio="16:9")
    assert [i["aspect_ratio"] for i in data["highlight_instances"]] == ["16:9"]


def test_save_rejects_unrecognized_aspect_ratio(client, game_id):
    resp = client.post(
        "/api/clips/raw/save",
        json={"game_id": game_id, "start_time": 1.0, "end_time": 6.0,
              "create_project": True, "aspect_ratio": "4:3"},
    )
    assert resp.status_code == 422


def test_force_new_returns_full_list_matching_reload(client, game_id):
    first = _save(client, game_id, create_project=True)
    clip_id = first["raw_clip_id"]

    resp = client.put(
        f"/api/clips/raw/{clip_id}",
        json={"create_project": True, "force_new": True, "aspect_ratio": "16:9"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["project_created"] is True
    assert len(data["highlight_instances"]) == 2
    assert data["highlight_instances"] == _loaded_instances(clip_id)
    assert {i["aspect_ratio"] for i in data["highlight_instances"]} == {"9:16", "16:9"}


def test_update_without_project_change_returns_current_list(client, game_id):
    first = _save(client, game_id, create_project=True)
    clip_id = first["raw_clip_id"]
    resp = client.put(f"/api/clips/raw/{clip_id}", json={"notes": "n"})
    assert resp.status_code == 200
    assert resp.json()["highlight_instances"] == _loaded_instances(clip_id)


def test_get_highlight_instances_endpoint_matches_reload(client, game_id):
    first = _save(client, game_id, create_project=True)
    clip_id = first["raw_clip_id"]
    resp = client.get(f"/api/clips/raw/{clip_id}/highlight-instances")
    assert resp.status_code == 200
    assert resp.json()["highlight_instances"] == _loaded_instances(clip_id)


def test_get_highlight_instances_404_for_unknown_clip(client):
    assert client.get("/api/clips/raw/999999/highlight-instances").status_code == 404
