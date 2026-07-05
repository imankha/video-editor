"""
Bug reproduction: deleting a draft reel that has a final video fails.

User report: "When I delete a reel from draft reels I get 'Failed to load reel
drafts' with an error in the console."

Root cause: final_videos.project_id references projects(id) WITHOUT
ON DELETE CASCADE (the only project-child table missing it). With
PRAGMA foreign_keys=ON, DELETE FROM projects on a draft that carries an
unpublished final video raises "FOREIGN KEY constraint failed" -> HTTP 500.
The frontend store shares one error slot, so the 500 surfaces as
"Failed to load reel drafts".
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_USER_ID = f"test_delete_final_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture
def draft_with_final_video():
    """A draft project (archived_at NULL) carrying an unpublished final video."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('Delete Final Bug', '9:16')"
        )
        project_id = cursor.lastrowid

        cursor.execute(
            """
            INSERT INTO final_videos (project_id, filename, version, published_at)
            VALUES (?, 'final_test.mp4', 1, NULL)
            """,
            (project_id,),
        )
        final_id = cursor.lastrowid
        conn.commit()

    yield project_id, final_id


def test_delete_draft_with_final_video(draft_with_final_video):
    project_id, final_id = draft_with_final_video

    resp = client.delete(f"/api/projects/{project_id}")
    assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        assert cursor.fetchone() is None, "project row should be gone"
        cursor.execute("SELECT id FROM final_videos WHERE id = ?", (final_id,))
        assert cursor.fetchone() is None, "final_video row should be gone with its project"
