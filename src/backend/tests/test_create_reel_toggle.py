"""
Tests for T1900: Explicit "Create Reel" toggle replacing auto-project behavior.

Run with: pytest src/backend/tests/test_create_reel_toggle.py -v
"""

import pytest
import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_reel_toggle_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

from app.session_init import _init_cache
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def setup_module():
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.user_context import set_current_user_id, reset_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id("testdefault")
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


from fastapi.testclient import TestClient
from app.main import app


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
            ("Toggle Test Game", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        conn.commit()
        return cursor.lastrowid


def test_new_clip_create_project_true(client, game_id):
    """create_project=true on a new clip creates a project."""
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 0.0,
        "end_time": 5.0,
        "rating": 3,
        "create_project": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_created"] is True
    assert data["project_id"] is not None


def test_new_clip_5star_without_toggle_no_project(client, game_id):
    """A 5-star clip without create_project should NOT auto-create a project."""
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 10.0,
        "end_time": 15.0,
        "rating": 5,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_created"] is False
    assert data["project_id"] is None


def test_new_clip_create_project_false_no_project(client, game_id):
    """create_project=false explicitly prevents project creation."""
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 20.0,
        "end_time": 25.0,
        "rating": 5,
        "create_project": False,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_created"] is False
    assert data["project_id"] is None


def test_update_with_create_project_true(client, game_id):
    """Updating an existing clip with create_project=true creates a project."""
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 30.0,
        "end_time": 35.0,
        "rating": 3,
    })
    clip_id = resp.json()["raw_clip_id"]

    resp2 = client.put(f"/api/clips/raw/{clip_id}", json={
        "create_project": True,
    })
    assert resp2.status_code == 200
    data = resp2.json()
    assert data["project_created"] is True
    assert data["project_id"] is not None


def test_rating_change_from_5_no_auto_delete(client, game_id):
    """Changing rating from 5 to 3 should NOT auto-delete the project."""
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 40.0,
        "end_time": 45.0,
        "rating": 5,
        "create_project": True,
    })
    data = resp.json()
    assert data["project_created"] is True
    clip_id = data["raw_clip_id"]
    project_id = data["project_id"]

    resp2 = client.put(f"/api/clips/raw/{clip_id}", json={
        "rating": 3,
    })
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["project_id"] == project_id


def test_resave_existing_clip_with_toggle(client, game_id):
    """Re-saving an existing clip (idempotent path) with create_project=true creates project."""
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 50.0,
        "end_time": 55.0,
        "rating": 4,
    })
    assert resp.json()["project_created"] is False

    resp2 = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 50.0,
        "end_time": 55.0,
        "rating": 4,
        "create_project": True,
    })
    data = resp2.json()
    assert data["project_created"] is True
    assert data["project_id"] is not None


def test_create_project_idempotent_when_exists(client, game_id):
    """create_project=true on a clip that already has a project is a no-op."""
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 60.0,
        "end_time": 65.0,
        "rating": 4,
        "create_project": True,
    })
    data = resp.json()
    assert data["project_created"] is True
    project_id = data["project_id"]

    resp2 = client.put(f"/api/clips/raw/{data['raw_clip_id']}", json={
        "create_project": True,
    })
    data2 = resp2.json()
    assert data2["project_created"] is False
    assert data2["project_id"] == project_id
