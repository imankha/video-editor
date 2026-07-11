"""
Regression tests for T4230: project write-path corruption.

Bug 1: refresh_outdated_clips reset crop_data/segments_data to NULL on ANY error
       during rescale (`except (json.JSONDecodeError, TypeError, Exception): new_crop_data = None`).
       A transient rescale bug destroyed the user's framing permanently.
       Fix: on decode/rescale failure, log ERROR and SKIP the clip (keep existing
       data, don't bump raw_clip_version).

Bug 2: PUT /projects/{id} wrote aspect_ratio, so a rename carrying a stale cached
       aspect_ratio reverted a just-changed ratio while crops stayed the new shape.
       Fix: PUT rename updates name only; aspect_ratio has one writer (the re-fit endpoint).
"""

import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.utils.encoding import encode_data
from app.session_init import _init_cache

TEST_USER_ID = f"test_t4230_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


def _set_ctx():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)


def _make_project():
    _set_ctx()
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T4230', '9:16')"
        )
        project_id = cursor.lastrowid
        conn.commit()
        return project_id


def _make_outdated_clip(project_id, crop_blob):
    """Create a raw_clip (boundaries_version=2) + a working_clip framed at version 1
    (so it is 'outdated' and the refresh endpoint will try to rescale it)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO raw_clips (filename, rating, start_time, end_time, boundaries_version)
            VALUES ('raw.mp4', 3, 0.0, 20.0, 2)
            """
        )
        raw_clip_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO working_clips (project_id, raw_clip_id, uploaded_filename, version,
                                       crop_data, segments_data, raw_clip_version)
            VALUES (?, ?, 'wc.mp4', 1, ?, NULL, 1)
            """,
            (project_id, raw_clip_id, crop_blob),
        )
        working_clip_id = cursor.lastrowid
        conn.commit()
    return working_clip_id


def _read_clip(working_clip_id):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT crop_data, raw_clip_version FROM working_clips WHERE id = ?",
            (working_clip_id,),
        )
        return cursor.fetchone()


def _read_aspect(project_id):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT aspect_ratio FROM projects WHERE id = ?", (project_id,))
        return cursor.fetchone()["aspect_ratio"]


def _cleanup(project_id):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM raw_clips WHERE id IN "
            "(SELECT raw_clip_id FROM working_clips WHERE project_id = ?)",
            (project_id,),
        )
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


# --- Bug 1: rescale error must not NULL the crop data -------------------------

def test_rescale_error_keeps_crop_data_intact():
    """A rescale-math error (a keyframe missing 'frame') must skip the clip and leave
    crop_data byte-identical -- never reset to NULL."""
    project_id = _make_project()
    # Valid, decodable crop data whose middle keyframe is missing 'frame' -> the
    # rescale loop raises KeyError.
    crop = encode_data([
        {"frame": 0, "x": 0, "y": 0, "w": 100, "h": 100, "origin": "permanent"},
        {"x": 50, "y": 50, "w": 100, "h": 100, "origin": "user"},  # missing 'frame'
        {"frame": 450, "x": 0, "y": 0, "w": 100, "h": 100, "origin": "permanent"},
    ])
    working_clip_id = _make_outdated_clip(project_id, crop)
    try:
        before = _read_clip(working_clip_id)
        response = client.post(
            f"/api/projects/{project_id}/refresh-outdated-clips",
            json={"working_clip_ids": [working_clip_id]},
        )
        assert response.status_code == 200, response.text
        # Endpoint succeeds but skipped the bad clip (refreshed 0).
        assert response.json()["refreshed_count"] == 0

        after = _read_clip(working_clip_id)
        assert bytes(after["crop_data"]) == bytes(before["crop_data"])  # untouched
        assert after["raw_clip_version"] == 1  # version NOT bumped
    finally:
        _cleanup(project_id)


def test_undecodable_crop_keeps_data_intact():
    """Genuinely undecodable crop bytes must skip the clip and leave crop_data intact."""
    project_id = _make_project()
    garbage = b"\xff\xfe\x00not-msgpack\x80\x81"
    working_clip_id = _make_outdated_clip(project_id, garbage)
    try:
        response = client.post(
            f"/api/projects/{project_id}/refresh-outdated-clips",
            json={"working_clip_ids": [working_clip_id]},
        )
        assert response.status_code == 200, response.text
        assert response.json()["refreshed_count"] == 0

        after = _read_clip(working_clip_id)
        assert bytes(after["crop_data"]) == garbage
        assert after["raw_clip_version"] == 1
    finally:
        _cleanup(project_id)


def test_valid_crop_still_rescales():
    """Control: a valid outdated clip still rescales and bumps its version (happy path
    is not broken by the skip-on-error change)."""
    project_id = _make_project()
    crop = encode_data([
        {"frame": 0, "x": 0, "y": 0, "w": 100, "h": 100, "origin": "permanent"},
        {"frame": 900, "x": 0, "y": 0, "w": 100, "h": 100, "origin": "permanent"},
    ])
    working_clip_id = _make_outdated_clip(project_id, crop)
    try:
        response = client.post(
            f"/api/projects/{project_id}/refresh-outdated-clips",
            json={"working_clip_ids": [working_clip_id]},
        )
        assert response.status_code == 200, response.text
        assert response.json()["refreshed_count"] == 1
        after = _read_clip(working_clip_id)
        assert after["crop_data"] is not None
        assert after["raw_clip_version"] == 2  # bumped to boundaries_version
    finally:
        _cleanup(project_id)


# --- Bug 2: rename PUT must not touch aspect_ratio ----------------------------

def test_rename_put_cannot_change_aspect_ratio():
    """PUT /projects/{id} carrying aspect_ratio must NOT change it (rename is name-only)."""
    project_id = _make_project()  # created at '9:16'
    try:
        # Simulate: ratio was changed to 16:9 by the re-fit endpoint...
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE projects SET aspect_ratio = '16:9' WHERE id = ?", (project_id,)
            )
            conn.commit()

        # ...then a rename fires carrying a STALE aspect_ratio from the cached list.
        response = client.put(
            f"/api/projects/{project_id}",
            json={"name": "Renamed Reel", "aspect_ratio": "9:16"},
        )
        assert response.status_code == 200, response.text

        assert _read_aspect(project_id) == "16:9"  # unchanged by rename
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM projects WHERE id = ?", (project_id,))
            assert cursor.fetchone()["name"] == "Renamed Reel"
    finally:
        _cleanup(project_id)
