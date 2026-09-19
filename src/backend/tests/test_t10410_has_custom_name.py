"""
T10410: RawClipResponse.has_custom_name.

The raw-clip API always returns a DERIVED `name` (queries.derive_clip_name fills
one in when nothing is stored), so the client cannot tell a user-typed name
from a generated one by looking at `name`. `has_custom_name` carries that
distinction for the Annotate editor's "Play named" progress badge.

Run with: pytest src/backend/tests/test_t10410_has_custom_name.py -v
"""

import itertools
import shutil
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.session_init import _init_cache

TEST_USER_ID = f"test_t10410_{uuid.uuid4().hex[:8]}"
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
def game_id(client):
    from app.database import get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("T10410 Game", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        conn.commit()
        return cursor.lastrowid


_END_TIMES = itertools.count(5)


def _save(client, game_id, **extra):
    # Distinct end_time per save: the natural key is game_id + end_time +
    # video_sequence, and a repeat is an idempotent update of the same row.
    end_time = float(next(_END_TIMES))
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": end_time - 4.0,
        "end_time": end_time,
        "rating": 4,
        "tags": ["Goal"],
        **extra,
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["raw_clip_id"]


def _get(client, clip_id):
    resp = client.get(f"/api/clips/raw/{clip_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_derived_name_reports_has_custom_name_false(client, game_id):
    """No stored name: `name` is still populated (derived from rating+tags), but
    has_custom_name says it is not the user's."""
    clip_id = _save(client, game_id)
    clip = _get(client, clip_id)
    assert clip["name"]  # derived, non-empty
    assert clip["has_custom_name"] is False


def test_stored_name_reports_has_custom_name_true(client, game_id):
    clip_id = _save(client, game_id, name="Ava's header goal")
    clip = _get(client, clip_id)
    assert clip["name"] == "Ava's header goal"
    assert clip["has_custom_name"] is True


def test_list_endpoint_carries_the_same_flag(client, game_id):
    custom_id = _save(client, game_id, name="Custom")
    derived_id = _save(client, game_id)
    resp = client.get("/api/clips/raw", params={"game_id": game_id})
    assert resp.status_code == 200, resp.text
    by_id = {c["id"]: c for c in resp.json()}
    assert by_id[custom_id]["has_custom_name"] is True
    assert by_id[derived_id]["has_custom_name"] is False
