"""
T10700 -- backend/compat half of nullable rating (design doc § 3.A.2, § 3.A.6).

Covers the clip-level request/response model changes and the idempotent-retry
COALESCE fix that the migration (v054, tested separately in
test_t10690_migration_v054.py) alone does not exercise:

- POST /api/clips/raw/save with no `rating` field -> stores NULL, returns
  `rating: null` (currently 500s or defaults to 3: `RawClipCreate.rating: int = 3`).
- GET /api/clips/raw (list) -> an unrated clip shows `rating: null` (currently
  `RawClipResponse.rating: int` would 500 on a NULL row from the DB, once the
  migration lands; today it can't even reach that state without A.2).
- PUT /api/clips/raw/{id} {rating: 5} -> sets it (already works today; kept as
  a control/regression anchor).
- A retried create (idempotent update path, same game_id+end_time+video_sequence
  natural key) with an absent rating must NOT clobber a rating set in between
  (the COALESCE fix, A.6) -- today `SET rating = ?` unconditionally overwrites
  with the Pydantic default (3), clobbering whatever was there.

This file is written test-first (Stage 3): A.2/A.6 are NOT implemented yet
(`RawClipCreate.rating` is still `int = 3`, `RawClipResponse.rating` is still
`int`, and the retry UPDATE still does `rating = ?` not
`rating = COALESCE(?, rating)`), so the create/list/retry tests below are
expected to fail against current code. The `test_put_sets_rating` case is a
happy-path control and should already pass.
"""

import shutil
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.session_init import _init_cache

TEST_USER_ID = f"test_t10700_{uuid.uuid4().hex[:8]}"
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
            ("T10700 Game", "test_hash_" + uuid.uuid4().hex[:32]),
        )
        conn.commit()
        return cursor.lastrowid


def test_create_with_no_rating_field_stores_null(client, game_id):
    """POST /api/clips/raw/save with rating omitted from the payload must
    store NULL and return `rating: null`, not silently default to 3
    (RawClipCreate.rating: int = 3 today)."""
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 10.0,
        "end_time": 14.0,
        "tags": ["Goal"],
        # no "rating" key at all
    })
    assert resp.status_code == 200, resp.text
    clip_id = resp.json()["raw_clip_id"]

    get_resp = client.get(f"/api/clips/raw/{clip_id}")
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["rating"] is None, get_resp.json()


def test_list_endpoint_shows_null_rating(client, game_id):
    """GET /api/clips/raw (list) must carry `rating: null` for an unrated
    clip. RawClipResponse.rating is still declared `int` today, so once the
    DB can hold a NULL (post-migration) this would 500 via Pydantic
    validation instead of serializing null."""
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 20.0,
        "end_time": 24.0,
        "tags": ["Assist"],
    })
    assert resp.status_code == 200, resp.text
    clip_id = resp.json()["raw_clip_id"]

    list_resp = client.get("/api/clips/raw", params={"game_id": game_id})
    assert list_resp.status_code == 200, list_resp.text
    by_id = {c["id"]: c for c in list_resp.json()}
    assert clip_id in by_id
    assert by_id[clip_id]["rating"] is None


def test_put_sets_rating(client, game_id):
    """Control/regression anchor: PUT with an explicit rating still sets it.
    This should already pass today (RawClipUpdate.rating is unchanged by A.2)."""
    resp = client.post("/api/clips/raw/save", json={
        "game_id": game_id,
        "start_time": 30.0,
        "end_time": 34.0,
        "tags": ["Dribble"],
    })
    assert resp.status_code == 200, resp.text
    clip_id = resp.json()["raw_clip_id"]

    put_resp = client.put(f"/api/clips/raw/{clip_id}", json={"rating": 5})
    assert put_resp.status_code == 200, put_resp.text

    get_resp = client.get(f"/api/clips/raw/{clip_id}")
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["rating"] == 5


def test_retried_create_does_not_clobber_rating_set_in_between(client, game_id):
    """A.6: save_raw_clip's idempotent-retry UPDATE branch (same
    game_id+end_time+video_sequence natural key) must COALESCE the incoming
    rating against the existing one, not unconditionally overwrite.

    Sequence: create with no rating (NULL) -> PUT to set rating=4 -> retry
    the same create (still no rating field, simulating a client retry/replay
    of the original request) -> rating must still be 4, not clobbered back
    to NULL or to the Pydantic default (3).
    """
    payload = {
        "game_id": game_id,
        "start_time": 40.0,
        "end_time": 44.0,
        "tags": ["Goal"],
    }
    resp = client.post("/api/clips/raw/save", json=payload)
    assert resp.status_code == 200, resp.text
    clip_id = resp.json()["raw_clip_id"]

    put_resp = client.put(f"/api/clips/raw/{clip_id}", json={"rating": 4})
    assert put_resp.status_code == 200, put_resp.text
    assert client.get(f"/api/clips/raw/{clip_id}").json()["rating"] == 4

    # Retry: same natural key (game_id, end_time, no video_sequence), no
    # rating field -- this hits the idempotent UPDATE branch in save_raw_clip.
    retry_resp = client.post("/api/clips/raw/save", json=payload)
    assert retry_resp.status_code == 200, retry_resp.text
    assert retry_resp.json()["raw_clip_id"] == clip_id  # same row, not a duplicate

    final = client.get(f"/api/clips/raw/{clip_id}")
    assert final.status_code == 200, final.text
    assert final.json()["rating"] == 4, (
        "a retried create with an absent rating must not clobber a rating "
        "set in between -- see design doc § A.6 COALESCE fix"
    )
