"""
T11220 — restore-project must REFUSE a legacy multi-clip published reel, loudly.

The single-clip editor (the target state of the single-clip-editor epic) cannot
represent a multi-clip project. `POST /api/downloads/{id}/restore-project`
(restore_project_from_archive) previously unpublished + restored ANY reel with a
project_id, which would drop a multi-clip project into an editor that can't edit
it. Per R4 (owner-approved) the restore must refuse a `clip_count > 1` reel with
a clear error and WITHOUT unpublishing it (no silent fallback / no partial state).

A single-clip reel (clip_count == 1) and an unknown-count reel (clip_count NULL,
a possible legacy single-clip) are unaffected — only clip_count > 1 is refused,
mirroring the frontend Re-edit gate.

Written PRE-IMPLEMENTATION (Stage 3): the multi-clip refusal case FAILS against
the pre-change handler (it 404s on the missing archive or 200s), and passes once
the clip_count > 1 guard lands ahead of the unpublish UPDATE.
"""

import sqlite3
from unittest.mock import patch

import pytest
from fastapi import HTTPException

USER_ID = "t11220-user"
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


def _connect(path):
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_published_reel(path, *, clip_count):
    """A published reel with a live (un-archived) project so restore never needs
    the R2 archive path — isolates the clip_count refusal from archive I/O."""
    conn = _connect(path)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO projects (name, aspect_ratio) VALUES ('Legacy Reel', '9:16')")
    project_id = cur.lastrowid
    cur.execute(
        "INSERT INTO final_videos "
        "(project_id, filename, version, source_type, name, clip_count, published_at) "
        "VALUES (?, 'final.mp4', 1, 'custom_project', 'Legacy Reel', ?, CURRENT_TIMESTAMP)",
        (project_id, clip_count))
    final_video_id = cur.lastrowid
    conn.commit()
    conn.close()
    return project_id, final_video_id


def _is_published(path, project_id):
    conn = _connect(path)
    row = conn.execute(
        "SELECT published_at FROM final_videos WHERE project_id = ?",
        (project_id,)).fetchone()
    conn.close()
    return row["published_at"] is not None


@pytest.mark.asyncio
async def test_restore_refuses_multiclip_reel_and_keeps_it_published(db_path):
    from app.routers.downloads import restore_project_from_archive

    project_id, final_video_id = _seed_published_reel(db_path, clip_count=3)

    with pytest.raises(HTTPException) as exc:
        await restore_project_from_archive(final_video_id)

    assert exc.value.status_code == 400
    # Refusal must NOT have unpublished the reel (no partial/lossy state).
    assert _is_published(db_path, project_id), \
        "a refused multi-clip restore must leave the reel published"


@pytest.mark.asyncio
async def test_restore_allows_single_clip_reel(db_path):
    """A clip_count == 1 reel is still editable — restore unpublishes it (moves
    it back to a draft) exactly as before."""
    from app.routers.downloads import restore_project_from_archive

    project_id, final_video_id = _seed_published_reel(db_path, clip_count=1)

    result = await restore_project_from_archive(final_video_id)

    assert result["project_id"] == project_id
    assert not _is_published(db_path, project_id), \
        "restoring a single-clip reel unpublishes it (back to draft)"


@pytest.mark.asyncio
async def test_restore_allows_unknown_clip_count_reel(db_path):
    """clip_count NULL (a possible legacy single-clip) is NOT refused — only
    clip_count > 1 is, matching the frontend Re-edit gate."""
    from app.routers.downloads import restore_project_from_archive

    project_id, final_video_id = _seed_published_reel(db_path, clip_count=None)

    result = await restore_project_from_archive(final_video_id)

    assert result["project_id"] == project_id
