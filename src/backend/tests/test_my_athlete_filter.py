"""
Tests for T2860: My Athlete filter on GET /api/clips/raw.
Covers the my_athlete query parameter filtering with mixed data (true/false/null).
Run with: pytest src/backend/tests/test_my_athlete_filter.py -v
"""

import pytest
import shutil
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_my_athlete_filter_{uuid.uuid4().hex[:8]}"
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


@pytest.fixture(scope="module")
def game_id(client):
    from app.database import get_db_connection
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
            ("My Athlete Filter Test", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        conn.commit()
        return cursor.lastrowid


@pytest.fixture(scope="module")
def mixed_clips(client, game_id):
    """Create clips with my_athlete=true, my_athlete=false, and my_athlete=null (pre-migration)."""
    from app.database import get_db_connection

    clip_ids = {}

    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 0.0,
        "end_time": 10.0,
        "name": "My athlete clip",
        "rating": 4,
        "tags": [],
        "my_athlete": True,
    })
    assert resp.status_code == 200
    clip_ids["my_athlete_true"] = resp.json()["raw_clip_id"]

    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 10.0,
        "end_time": 20.0,
        "name": "Teammate clip",
        "rating": 3,
        "tags": [],
        "my_athlete": False,
    })
    assert resp.status_code == 200
    clip_ids["my_athlete_false"] = resp.json()["raw_clip_id"]

    # Pre-migration clip: set my_athlete to NULL directly in DB
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 20.0,
        "end_time": 30.0,
        "name": "Pre-migration clip",
        "rating": 5,
        "tags": [],
    })
    assert resp.status_code == 200
    clip_ids["my_athlete_null"] = resp.json()["raw_clip_id"]

    with get_db_connection() as conn:
        conn.execute(
            "UPDATE raw_clips SET my_athlete = NULL WHERE id = ?",
            (clip_ids["my_athlete_null"],),
        )
        conn.commit()

    return clip_ids


class TestMyAthleteFilter:
    def test_no_filter_returns_all(self, client, mixed_clips):
        resp = client.get("/api/clips/raw")
        assert resp.status_code == 200
        ids = {c["id"] for c in resp.json()}
        assert mixed_clips["my_athlete_true"] in ids
        assert mixed_clips["my_athlete_false"] in ids
        assert mixed_clips["my_athlete_null"] in ids

    def test_my_athlete_true_includes_true_and_null(self, client, mixed_clips):
        resp = client.get("/api/clips/raw?my_athlete=true")
        assert resp.status_code == 200
        ids = {c["id"] for c in resp.json()}
        assert mixed_clips["my_athlete_true"] in ids
        assert mixed_clips["my_athlete_null"] in ids
        assert mixed_clips["my_athlete_false"] not in ids

    def test_my_athlete_true_excludes_teammate_clips(self, client, mixed_clips):
        resp = client.get("/api/clips/raw?my_athlete=true")
        assert resp.status_code == 200
        for clip in resp.json():
            assert clip["my_athlete"] is not False
