"""
T11220 — GET /api/projects/{id} (ProjectDetailResponse) must expose clip_count.

The frontend re-frame guard (allowEnterFraming) reads clip_count off the SELECTED
project, which is populated from this detail response. Before this task the detail
response had NO clip_count field at all, so every selectedProject-based guard
(header ModeSwitcher, App.handleModeChange, project-load default) silently saw
`undefined > 1 === false` and never fired. This pins clip_count onto the detail
response, derived from the SAME working-clips list it returns (so it can never
diverge from what the response actually contains).

Written to FAIL against the pre-fix handler (no clip_count attribute) and pass
after `clip_count=len(clips)` lands on ProjectDetailResponse.
"""

import sqlite3
from unittest.mock import patch

import pytest

USER_ID = "t11220-detail-user"
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


def _seed_project_with_clips(path, *, n_clips):
    """A draft project with n distinct latest-version working clips (each backed
    by its own raw clip) — the multi-clip shape a legacy reel draft has."""
    conn = _connect(path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Legacy Reel Draft', '9:16')")
    project_id = cur.lastrowid
    for i in range(n_clips):
        # Distinct end_time per clip: working-clip identity is
        # COALESCE(rc.end_time, wc.uploaded_filename), so clips must differ here
        # to count as distinct latest clips (else they collapse into one).
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, start_time, end_time) VALUES (?, 5, ?, ?)",
            (f"raw{i}.mp4", float(i * 10), float(i * 10 + 5)))
        raw_id = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) "
            "VALUES (?, ?, 1, ?)",
            (project_id, raw_id, i))
    conn.commit()
    conn.close()
    return project_id


@pytest.mark.asyncio
async def test_detail_response_exposes_multiclip_count(db_path):
    from app.routers.projects import get_project

    project_id = _seed_project_with_clips(db_path, n_clips=2)

    detail = await get_project(project_id)

    # The field must exist AND equal the number of clips actually returned.
    assert detail.clip_count == 2
    assert detail.clip_count == len(detail.clips), \
        "clip_count must be derived from the clips this response returns (no drift)"


@pytest.mark.asyncio
async def test_detail_response_single_clip_count(db_path):
    from app.routers.projects import get_project

    project_id = _seed_project_with_clips(db_path, n_clips=1)

    detail = await get_project(project_id)

    assert detail.clip_count == 1
    assert detail.clip_count == len(detail.clips)
