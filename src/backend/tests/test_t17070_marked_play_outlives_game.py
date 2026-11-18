"""
T17070: a marked play outlives its game's storage.

Staging 2026-11-17: "Edit highlight" on a play whose game had expired showed
"Game video expired ... can't be edited" because the clip playback-url seam
answered 410 source_expired whenever the GAME was expired, even though the
play still had its own surviving video (the T4175 preserved extract or its
T4140 recap segment) -- the same sources the Frame export already renders from
(export_helpers.resolve_clip_source).

The playback-url seam now resolves an expired game's play through that chain;
it only answers 410 when nothing at all survives.
"""

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_USER_ID = f"test_t17070_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"
_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}
client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})

HASH = "t17070expiredhash"


def _presign(user_id, relative_path, *args, **kwargs):
    return f"https://r2.example.com/{relative_path}?sig=t"


def _make_expired_play(raw_filename):
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO games (name, blake3_hash, video_filename, video_duration, video_size) "
            "VALUES ('varA', ?, 'g.mp4', 600.0, 1000000000)",
            (HASH,),
        )
        game_id = cursor.lastrowid
        cursor.execute(
            "INSERT OR REPLACE INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) "
            "VALUES (?, ?, ?)",
            (HASH, 1000000000, (datetime.now(UTC) - timedelta(days=3)).isoformat()),
        )
        cursor.execute(
            "INSERT INTO raw_clips (game_id, start_time, end_time, filename, rating) "
            "VALUES (?, 100.0, 108.0, ?, 4)",
            (game_id, raw_filename),
        )
        raw_clip_id = cursor.lastrowid
        cursor.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('P', '9:16')")
        project_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version, crop_data, segments_data) "
            "VALUES (?, ?, 1, '[]', '{}')",
            (project_id, raw_clip_id),
        )
        clip_id = cursor.lastrowid
        conn.commit()
    return game_id, raw_clip_id, project_id, clip_id


@pytest.fixture
def cleanup():
    yield
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        c = conn.cursor()
        c.execute("DELETE FROM working_clips")
        c.execute("DELETE FROM projects")
        c.execute("DELETE FROM raw_clips")
        c.execute("DELETE FROM games")
        c.execute("DELETE FROM game_storage WHERE blake3_hash = ?", (HASH,))
        conn.commit()


def _get(project_id, clip_id, mapping=None):
    with patch("app.storage.r2_head_object_global", return_value=None), \
         patch("app.storage.generate_presigned_url", side_effect=_presign), \
         patch("app.services.auto_export.load_recap_mapping",
               return_value=(None, mapping or [])):
        return client.get(f"/api/clips/projects/{project_id}/clips/{clip_id}/playback-url")


def test_expired_game_play_with_preserved_extract_plays_its_extract(cleanup):
    _, _, project_id, clip_id = _make_expired_play("auto_1_1_abc.mp4")
    r = _get(project_id, clip_id)
    assert r.status_code == 200, f"marked play must stay playable, got {r.status_code}: {r.text}"
    body = r.json()
    assert "raw_clips/auto_1_1_abc.mp4" in body["url"]
    assert body["start_time"] == 0.0
    assert body["end_time"] == pytest.approx(8.0)


def test_expired_game_play_without_extract_plays_its_recap_segment(cleanup):
    _, raw_clip_id, project_id, clip_id = _make_expired_play("")
    mapping = [{"id": raw_clip_id, "recap_start": 12.0, "recap_end": 20.0}]
    r = _get(project_id, clip_id, mapping)
    assert r.status_code == 200, f"marked play must stay playable, got {r.status_code}: {r.text}"
    body = r.json()
    assert "recaps/" in body["url"]
    assert body["start_time"] == 12.0
    assert body["end_time"] == 20.0


def test_expired_game_play_with_nothing_surviving_still_410(cleanup):
    _, _, project_id, clip_id = _make_expired_play("")
    r = _get(project_id, clip_id)
    assert r.status_code == 410, r.text
    assert r.json()["detail"]["code"] == "source_expired"
