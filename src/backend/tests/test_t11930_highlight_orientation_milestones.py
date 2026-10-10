"""
T11930 -- orientation-split highlight milestones (Portrait vs Landscape choice).

Every highlight creation emits an ATTEMPT (before the project is minted) and, only
after the commit, a SUCCESS, each split by orientation, so the admin can read
tries/successes per slot. First-ever make and "both orientations on one play" are
separate one-shot events. Emission is server-side at the durable seam, not a
client beacon.

Real DB via TestClient, record_milestone captured at the clips router.
"""

import shutil
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.session_init import _init_cache

TEST_USER_ID = f"test_t11930_{uuid.uuid4().hex[:8]}"
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
def milestones(monkeypatch):
    calls = []
    monkeypatch.setattr(
        "app.routers.clips.record_milestone",
        lambda user_id, event, context=None, reason=None: calls.append(event),
    )
    return calls


@pytest.fixture
def game_id():
    from app.database import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("T11930 Game", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        conn.commit()
        return cursor.lastrowid


def _highlight_events(calls):
    return [c for c in calls if c.startswith("highlight_")]


def _save(client, game_id, **extra):
    body = {"game_id": game_id, "start_time": 1.0, "end_time": 6.0, "rating": 5, **extra}
    resp = client.post("/api/clips/raw/save", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _clear_projects():
    from app.database import get_db_connection

    with get_db_connection() as conn:
        conn.cursor().execute("DELETE FROM projects")
        conn.commit()


def test_landscape_make_emits_attempt_then_success_then_first(client, game_id, milestones):
    _clear_projects()
    _save(client, game_id, create_project=True, aspect_ratio="16:9")
    assert _highlight_events(milestones) == [
        "highlight_make_attempted_landscape",
        "highlight_made_landscape",
        "highlight_first_made_landscape",
    ]


def test_second_make_is_not_first_and_other_orientation_marks_both(client, game_id, milestones):
    first = _save(client, game_id, create_project=True)  # portrait
    del milestones[:]
    resp = client.put(
        f"/api/clips/raw/{first['raw_clip_id']}",
        json={"create_project": True, "force_new": True, "aspect_ratio": "16:9"},
    )
    assert resp.status_code == 200, resp.text
    assert _highlight_events(milestones) == [
        "highlight_make_attempted_landscape",
        "highlight_made_landscape",
        "highlight_both_orientations",
    ]


def test_same_orientation_twice_is_not_both(client, game_id, milestones):
    first = _save(client, game_id, create_project=True)
    del milestones[:]
    client.put(
        f"/api/clips/raw/{first['raw_clip_id']}",
        json={"create_project": True, "force_new": True, "aspect_ratio": "9:16"},
    )
    assert _highlight_events(milestones) == [
        "highlight_make_attempted_portrait",
        "highlight_made_portrait",
    ]


def test_rejected_orientation_records_no_attempt(client, game_id, milestones):
    resp = client.post(
        "/api/clips/raw/save",
        json={"game_id": game_id, "start_time": 1.0, "end_time": 6.0,
              "create_project": True, "aspect_ratio": "4:3"},
    )
    assert resp.status_code == 422
    assert _highlight_events(milestones) == []


def test_save_without_create_project_emits_nothing(client, game_id, milestones):
    _save(client, game_id)
    assert _highlight_events(milestones) == []


def test_events_registered_in_flow_events():
    from app.analytics import FLOW_EVENTS

    for name in (
        "highlight_make_attempted_portrait", "highlight_make_attempted_landscape",
        "highlight_made_portrait", "highlight_made_landscape",
        "highlight_first_made_portrait", "highlight_first_made_landscape",
        "highlight_both_orientations",
    ):
        assert name in FLOW_EVENTS, name
