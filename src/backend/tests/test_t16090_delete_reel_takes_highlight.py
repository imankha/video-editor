"""
T16090: a deleted reel takes its highlight with it.

Bug: publishing a highlight archives its project (working_clips/videos moved
to an R2 msgpack, final_videos row created). Deleting the reel only cleared
projects.final_video_id and the final_videos row -- the archived project (and
its R2 archive) stayed behind with no reel, so Annotate kept listing a
highlight that opened Frame on zero plays (the endless "Loading..." T16040
investigated, root cause T16090; see hello@reelballers.com staging project 4
"Play 5"). Owner ruling: deleting a reel deletes the project it came from
(row + R2 archive); the play (raw clip) stays and its link clears.
"""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_USER_ID = f"test_t16090_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture
def published_highlight():
    """A raw clip with a published highlight: project archived, final_video
    linked, raw_clip.auto_project_id pointing at the project -- the shape
    publish leaves behind (R2 disabled in tests, so working rows aren't
    actually deleted, but archived_at + final_video_id is what this bug and
    its fix hinge on)."""
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO raw_clips (filename, start_time, end_time) "
            "VALUES ('play5.mp4', 0, 10)"
        )
        raw_clip_id = cursor.lastrowid

        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio, archived_at, source_raw_clip_id) "
            "VALUES ('Play 5 highlight', '9:16', CURRENT_TIMESTAMP, ?)",
            (raw_clip_id,),
        )
        project_id = cursor.lastrowid

        cursor.execute(
            "UPDATE raw_clips SET auto_project_id = ? WHERE id = ?",
            (project_id, raw_clip_id),
        )

        cursor.execute(
            "INSERT INTO final_videos (project_id, filename, version, published_at) "
            "VALUES (?, 'final_play5.mp4', 1, CURRENT_TIMESTAMP)",
            (project_id,),
        )
        final_id = cursor.lastrowid

        cursor.execute(
            "UPDATE projects SET final_video_id = ? WHERE id = ?",
            (final_id, project_id),
        )
        conn.commit()

    yield raw_clip_id, project_id, final_id


def test_delete_reel_deletes_its_project(published_highlight):
    """T16090:C1 -- deleting a reel deletes its project (row + R2 archive)
    and clears the play's link to it; the play itself remains."""
    raw_clip_id, project_id, final_id = published_highlight

    with patch("app.services.project_archive.R2_ENABLED", True), \
         patch("app.services.project_archive.delete_from_r2") as mock_delete_r2:
        mock_delete_r2.return_value = True
        resp = client.delete(f"/api/downloads/{final_id}")
    assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.text}"

    mock_delete_r2.assert_called_once_with(TEST_USER_ID, f"archive/{project_id}.msgpack")

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM projects WHERE id = ?", (project_id,))
        assert cursor.fetchone() is None, "project row should be gone with its reel"

        cursor.execute(
            "SELECT id, auto_project_id FROM raw_clips WHERE id = ?", (raw_clip_id,)
        )
        row = cursor.fetchone()
        assert row is not None, "the play itself must remain"
        assert row["auto_project_id"] is None, (
            "the play's link to the deleted project must clear"
        )


def test_migration_deletes_only_orphaned_archived_projects():
    """T16090:C2 -- the v061 migration deletes archived projects with no reel
    (and their R2 archive), clearing the matching raw clip links; archived
    projects that still have a reel are untouched."""
    from app.migrations.profile_db.v061_delete_orphan_archived_projects import (
        V061DeleteOrphanArchivedProjects,
    )

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()

        # Orphan: archived, no reel -- the T16090 bug shape, must be deleted.
        cursor.execute(
            "INSERT INTO raw_clips (filename, start_time, end_time) "
            "VALUES ('orphan.mp4', 0, 5)"
        )
        orphan_clip_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio, archived_at) "
            "VALUES ('Orphan highlight', '9:16', CURRENT_TIMESTAMP)"
        )
        orphan_project_id = cursor.lastrowid
        cursor.execute(
            "UPDATE raw_clips SET auto_project_id = ? WHERE id = ?",
            (orphan_project_id, orphan_clip_id),
        )

        # Kept: archived WITH a reel -- must survive untouched.
        cursor.execute(
            "INSERT INTO raw_clips (filename, start_time, end_time) "
            "VALUES ('kept.mp4', 0, 5)"
        )
        kept_clip_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO projects (name, aspect_ratio, archived_at) "
            "VALUES ('Kept highlight', '9:16', CURRENT_TIMESTAMP)"
        )
        kept_project_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO final_videos (project_id, filename, version, published_at) "
            "VALUES (?, 'kept_final.mp4', 1, CURRENT_TIMESTAMP)",
            (kept_project_id,),
        )
        kept_final_id = cursor.lastrowid
        cursor.execute(
            "UPDATE projects SET final_video_id = ? WHERE id = ?",
            (kept_final_id, kept_project_id),
        )
        cursor.execute(
            "UPDATE raw_clips SET auto_project_id = ? WHERE id = ?",
            (kept_project_id, kept_clip_id),
        )
        conn.commit()

        with patch("app.storage.R2_ENABLED", True), \
             patch("app.storage.delete_from_r2") as mock_delete_r2:
            mock_delete_r2.return_value = True
            V061DeleteOrphanArchivedProjects().up(conn)
        conn.commit()

        mock_delete_r2.assert_called_once_with(
            TEST_USER_ID, f"archive/{orphan_project_id}.msgpack"
        )

        cursor.execute("SELECT id FROM projects WHERE id = ?", (orphan_project_id,))
        assert cursor.fetchone() is None, "orphaned archived project must be deleted"

        cursor.execute(
            "SELECT auto_project_id FROM raw_clips WHERE id = ?", (orphan_clip_id,)
        )
        assert cursor.fetchone()["auto_project_id"] is None

        cursor.execute("SELECT id FROM projects WHERE id = ?", (kept_project_id,))
        assert cursor.fetchone() is not None, "archived project with a reel must survive"

        cursor.execute(
            "SELECT auto_project_id FROM raw_clips WHERE id = ?", (kept_clip_id,)
        )
        assert cursor.fetchone()["auto_project_id"] == kept_project_id


def test_migration_is_a_noop_on_a_db_missing_projects_or_raw_clips():
    """A below-head DB mid-sweep (or a test fixture at an earlier version,
    per the runner-sweep convention test_t4890/test_t5410/test_t6850 rely on)
    may not have the projects/raw_clips tables, or the archived_at/
    final_video_id columns, yet. v061 must not raise sqlite3.OperationalError
    in that case -- it has nothing to clean up on such a DB."""
    import sqlite3

    from app.migrations.profile_db.v061_delete_orphan_archived_projects import (
        V061DeleteOrphanArchivedProjects,
    )

    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE user_settings (id INTEGER PRIMARY KEY)")
    conn.commit()

    V061DeleteOrphanArchivedProjects().up(conn)  # must not raise

    conn.execute(
        "CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, aspect_ratio TEXT)"
    )
    conn.commit()

    V061DeleteOrphanArchivedProjects().up(conn)  # still missing raw_clips/columns; must not raise
    conn.close()
