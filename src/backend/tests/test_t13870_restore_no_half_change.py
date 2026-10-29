"""
T13870 -- a restore that fails BEFORE the project is back in the DB (archive missing,
or restore_project failing) must not half-change the DB: published_at stays set so
the reel stays in Finished. The unpublish UPDATE runs only after the archive restore.
"""

import sqlite3
from unittest.mock import patch

import pytest
from fastapi import HTTPException

USER_ID = "t13870-user"
PROFILE_ID = "testdefault"


@pytest.fixture()
def db_path(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _seed_archived_published_reel(path):
    """Published reel whose project is archived (needs an archive restore)."""
    conn = sqlite3.connect(str(path))
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio, archived_at) "
                "VALUES ('Archived', '9:16', CURRENT_TIMESTAMP)")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos "
        "(project_id, filename, version, source_type, name, clip_count, published_at) "
        "VALUES (?, 'final.mp4', 1, 'custom_project', 'Reel', 1, CURRENT_TIMESTAMP)",
        (project_id,))
    fv_id = cur.lastrowid
    conn.commit()
    conn.close()
    return project_id, fv_id


def _published_at(path, project_id):
    conn = sqlite3.connect(str(path))
    row = conn.execute("SELECT published_at FROM final_videos WHERE project_id = ?",
                       (project_id,)).fetchone()
    conn.close()
    return row[0]


@pytest.mark.asyncio
async def test_archive_missing_404_keeps_reel_published(db_path):
    from app.routers.downloads import restore_project_from_archive

    project_id, fv_id = _seed_archived_published_reel(db_path)
    with patch("app.routers.downloads.is_project_archived", return_value=False),          pytest.raises(HTTPException) as exc:
        await restore_project_from_archive(fv_id)
    assert exc.value.status_code == 404
    assert _published_at(db_path, project_id) is not None, \
        "a 404 archive-missing restore must leave the reel published"


@pytest.mark.asyncio
async def test_restore_failure_500_keeps_reel_published(db_path):
    from app.routers.downloads import restore_project_from_archive

    project_id, fv_id = _seed_archived_published_reel(db_path)
    with patch("app.routers.downloads.is_project_archived", return_value=True), \
         patch("app.routers.downloads.restore_project", return_value=False), pytest.raises(HTTPException) as exc:
        await restore_project_from_archive(fv_id)
    assert exc.value.status_code == 500
    assert _published_at(db_path, project_id) is not None


@pytest.mark.asyncio
async def test_successful_archive_restore_unpublishes(db_path):
    from app.routers.downloads import restore_project_from_archive

    project_id, fv_id = _seed_archived_published_reel(db_path)
    with patch("app.routers.downloads.is_project_archived", return_value=True), \
         patch("app.routers.downloads.restore_project", return_value=True):
        result = await restore_project_from_archive(fv_id)
    assert result["restored"] is True
    assert _published_at(db_path, project_id) is None
