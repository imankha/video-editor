"""
Regression tests for T4210: corrupt highlights_data must never silently become [].

Bug: `_get_overlay_data` used `except Exception: highlights = []` on decode failure.
Because every overlay action does read-modify-write of the whole blob, the user's next
gesture would persist the empty list and permanently erase every highlight region.

Fix: decode failure logs at ERROR and raises (endpoint returns 500); the stored blob is
left byte-identical for recovery. The orphaned `PUT /overlay-data` full-blob writer was
also deleted.
"""

import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache

TEST_USER_ID = f"test_t4210_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})
# Separate client that returns the 500 response instead of re-raising, so we can
# assert the endpoint fails visibly (as it does behind a real ASGI server).
client_no_raise = TestClient(
    app, headers={"X-User-ID": TEST_USER_ID}, raise_server_exceptions=False
)

# Bytes that are neither valid msgpack nor valid JSON -> decode_data raises.
CORRUPT_BLOB = b"\xff\xfe\x00\x01not-valid-msgpack-or-json\x80\x81"


def _make_project_with_corrupt_blob():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T4210 corrupt', '9:16')"
        )
        project_id = cursor.lastrowid
        cursor.execute(
            """
            INSERT INTO working_videos (project_id, filename, version, highlights_data, effect_type, overlay_version)
            VALUES (?, 'wv.mp4', 1, ?, 'original', 3)
            """,
            (project_id, CORRUPT_BLOB),
        )
        working_video_id = cursor.lastrowid
        cursor.execute(
            "UPDATE projects SET working_video_id = ? WHERE id = ?",
            (working_video_id, project_id),
        )
        conn.commit()
    return project_id, working_video_id


def _cleanup(project_id):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE projects SET working_video_id = NULL WHERE id = ?", (project_id,))
        cursor.execute("DELETE FROM working_videos WHERE project_id = ?", (project_id,))
        cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        conn.commit()


def _read_blob(working_video_id):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT highlights_data FROM working_videos WHERE id = ?", (working_video_id,)
        )
        return cursor.fetchone()["highlights_data"]


def test_corrupt_blob_action_returns_500_and_never_erases():
    """An action on a project whose highlights_data is corrupt must 500, not silently
    overwrite the blob with []."""
    project_id, working_video_id = _make_project_with_corrupt_blob()
    try:
        before = _read_blob(working_video_id)
        assert bytes(before) == CORRUPT_BLOB

        response = client_no_raise.post(
            f"/api/export/projects/{project_id}/overlay/actions",
            json={
                "action": "create_region",
                "data": {"start_time": 0.0, "end_time": 2.0, "region_id": "r1"},
            },
        )

        # Fails visibly instead of silently persisting [].
        assert response.status_code == 500, response.text

        # Stored blob is byte-identical: nothing overwrote the user's data.
        after = _read_blob(working_video_id)
        assert bytes(after) == CORRUPT_BLOB
    finally:
        _cleanup(project_id)


def test_orphaned_put_overlay_data_endpoint_is_gone():
    """The full-blob PUT /overlay-data writer was deleted (version-skipping overwrite risk)."""
    project_id, working_video_id = _make_project_with_corrupt_blob()
    try:
        response = client.put(
            f"/api/export/projects/{project_id}/overlay-data",
            data={"highlights_data": "[]", "text_overlays": "[]", "effect_type": "original"},
        )
        # Route no longer registered -> 404 (or 405 if only method removed).
        assert response.status_code in (404, 405), response.text
    finally:
        _cleanup(project_id)
