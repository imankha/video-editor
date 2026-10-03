"""
T11430 fixround1 MAJOR 3 -- delete_raw_clip must clean up EVERY highlight
project linked to a play (projects.source_raw_clip_id), not just the single one
in raw_clips.auto_project_id. Before the fix, "Make Another Highlight" drafts
survived as dead 0-clip orphan projects when the play was deleted.

T4800-style regression (mirrors tests/test_t4800_orphan_drafts.py): drive the
real production create + delete paths, then assert no surviving 0-clip orphan
projects -- while published and multi-clip projects are still preserved exactly
as _delete_auto_project already guaranteed for the single-pointer case.
"""

import shutil
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.session_init import _init_cache

TEST_USER_ID = f"test_t11430_delorphan_{uuid.uuid4().hex[:8]}"
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


def _new_clip(cursor, start=0.0, end=5.0):
    cursor.execute(
        "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
        ("T11430 DelOrphan Game", "test_hash_" + uuid.uuid4().hex[:32]),
    )
    game_id = cursor.lastrowid
    cursor.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, game_id) VALUES ('', 5, ?, ?, ?)",
        (start, end, game_id),
    )
    return cursor.lastrowid


def test_force_new_drafts_leave_no_orphans_on_delete(client):
    """Two drafts via force_new for the same play; delete the play -> zero
    surviving projects linked to it, and zero 0-clip orphan projects at all."""
    from app.database import get_db_connection
    from app.routers.clips import _create_auto_project_for_clip

    with get_db_connection() as conn:
        cursor = conn.cursor()
        clip_id = _new_clip(cursor)
        conn.commit()
        p1 = _create_auto_project_for_clip(cursor, clip_id, "Draft 1")
        p2 = _create_auto_project_for_clip(cursor, clip_id, "Draft 2")
        conn.commit()

    # Sanity: both exist, both link to the play.
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) AS n FROM projects WHERE source_raw_clip_id = ?", (clip_id,))
        assert cursor.fetchone()["n"] == 2

    resp = client.delete(f"/api/clips/raw/{clip_id}")
    assert resp.status_code == 200, resp.text

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id IN (?, ?)", (p1, p2))
        survivors = [r["id"] for r in cursor.fetchall()]
        # No 0-clip orphan projects anywhere.
        cursor.execute(
            """
            SELECT p.id FROM projects p
            WHERE (SELECT COUNT(*) FROM working_clips wc WHERE wc.project_id = p.id) = 0
              AND NOT EXISTS (SELECT 1 FROM final_videos fv WHERE fv.project_id = p.id AND fv.published_at IS NOT NULL)
            """
        )
        orphans = [r["id"] for r in cursor.fetchall()]

    assert survivors == [], f"force_new drafts must not survive play deletion, got {survivors!r}"
    assert orphans == [], f"no 0-clip orphan projects should remain, got {orphans!r}"


def test_delete_preserves_published_sibling_but_removes_dead_draft(client):
    """A play with one PUBLISHED highlight + one unpublished force_new draft:
    deleting the play removes the dead draft but PRESERVES the published one
    (lives in My Reels independently), exactly like the single-pointer rule."""
    from app.database import get_db_connection
    from app.routers.clips import _create_auto_project_for_clip

    with get_db_connection() as conn:
        cursor = conn.cursor()
        clip_id = _new_clip(cursor)
        conn.commit()
        published = _create_auto_project_for_clip(cursor, clip_id, "Published One")
        draft = _create_auto_project_for_clip(cursor, clip_id, "Dead Draft")
        # Publish the first: a final_videos row with published_at + archive it
        # (same shape publish_to_my_reels produces), and prune its working_clips.
        cursor.execute(
            "INSERT INTO final_videos (project_id, filename, version, name, published_at, source_clip_id, aspect_ratio) "
            "VALUES (?, 'pub.mp4', 1, 'Published One', CURRENT_TIMESTAMP, ?, '9:16')",
            (published, clip_id),
        )
        cursor.execute("DELETE FROM working_clips WHERE project_id = ?", (published,))
        cursor.execute("UPDATE projects SET archived_at = CURRENT_TIMESTAMP WHERE id = ?", (published,))
        conn.commit()

    resp = client.delete(f"/api/clips/raw/{clip_id}")
    assert resp.status_code == 200, resp.text

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (published,))
        pub_row = cursor.fetchone()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (draft,))
        draft_row = cursor.fetchone()

    assert pub_row is not None, "a published highlight must survive deletion of its source play"
    assert draft_row is None, "the dead unpublished draft must be cleaned up"
