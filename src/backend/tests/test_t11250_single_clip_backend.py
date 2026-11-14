"""
T11250 -- remove the multi-clip backend: clip-management endpoints, the
/export/multi-clip pipeline, transitions/chapters, and enforce one working clip
per project at every remaining insert site.

C2 "every insert site refuses a second clip": the remaining sites are
  * `_insert_working_clip_with_dims` -- the one blueprint behind
    `_create_auto_project_for_clip` (Make Highlight, materialization) and the
    auto-export sweep / v021 rebuilds;
  * `restore_project` -- the archive restore inserts working_clips verbatim.
  (The PUT clip-version path inserts a new VERSION of the same clip, not a
  second clip.)
C3 "deleted endpoints 404/405; zero references".
"""

import importlib.util
import sqlite3
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

USER_ID = "t11250-user"
PROFILE_ID = "testdefault"
REPO_ROOT = Path(__file__).resolve().parents[3]


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


def _seed_raw_clip(cur, name="Goal"):
    cur.execute(
        "INSERT INTO raw_clips (filename, rating, start_time, end_time, name) "
        "VALUES ('clip.mp4', 5, 0.0, 5.0, ?)", (name,))
    return cur.lastrowid


def _clip_count(path, project_id):
    conn = _connect(path)
    n = conn.execute(
        "SELECT COUNT(*) FROM working_clips WHERE project_id = ?", (project_id,)
    ).fetchone()[0]
    conn.close()
    return n


# ---------------------------------------------------------------------------
# C2: insert sites refuse a second clip
# ---------------------------------------------------------------------------

def test_create_site_project_gets_exactly_one_clip_and_refuses_a_second(db_path):
    """Make Highlight (`_create_auto_project_for_clip`) creates one clip; the
    shared insert blueprint refuses to add another clip to that project."""
    from app.routers.clips import _create_auto_project_for_clip, _insert_working_clip_with_dims

    conn = _connect(db_path)
    cur = conn.cursor()
    first = _seed_raw_clip(cur, "First")
    second = _seed_raw_clip(cur, "Second")
    project_id = _create_auto_project_for_clip(cur, first, "First")
    conn.commit()
    assert _clip_count(db_path, project_id) == 1

    with pytest.raises(Exception) as refused:
        _insert_working_clip_with_dims(
            cur, project_id=project_id, raw_clip_id=second, sort_order=1)
    assert type(refused.value).__name__ == "SecondClipRefused"
    conn.rollback()
    conn.close()
    assert _clip_count(db_path, project_id) == 1


def test_rebuild_site_blueprint_refuses_when_project_already_has_a_clip(db_path):
    """The auto-export sweep and v021 rebuild a missing working clip through the
    same blueprint; on a project that already has one it must refuse, not add."""
    from app.routers.clips import _insert_working_clip_with_dims

    conn = _connect(db_path)
    cur = conn.cursor()
    rc = _seed_raw_clip(cur)
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('P', '9:16')")
    project_id = cur.lastrowid
    # Empty project: the rebuild inserts the one clip.
    _insert_working_clip_with_dims(cur, project_id=project_id, raw_clip_id=rc, sort_order=0)
    conn.commit()
    # Same raw clip again is still a second working clip row for the project.
    with pytest.raises(Exception) as refused:
        _insert_working_clip_with_dims(cur, project_id=project_id, raw_clip_id=rc, sort_order=0)
    assert type(refused.value).__name__ == "SecondClipRefused"
    conn.rollback()
    conn.close()
    assert _clip_count(db_path, project_id) == 1


def test_restore_site_refuses_an_archive_with_two_clips(db_path):
    """`restore_project` must refuse (return False, insert nothing) an archive
    that would put two different clips into one project."""
    from app.services import project_archive

    conn = _connect(db_path)
    cur = conn.cursor()
    a = _seed_raw_clip(cur, "A")
    b = _seed_raw_clip(cur, "B")
    cur.execute(
        "INSERT INTO projects (name, aspect_ratio, archived_at) "
        "VALUES ('Legacy Reel', '9:16', CURRENT_TIMESTAMP)")
    project_id = cur.lastrowid
    conn.commit()
    conn.close()

    archive = {
        "project": {"id": project_id, "name": "Legacy Reel", "aspect_ratio": "9:16",
                    "working_video_id": None},
        "working_clips": [
            {"id": 9001, "project_id": project_id, "raw_clip_id": a, "sort_order": 0, "version": 1},
            {"id": 9002, "project_id": project_id, "raw_clip_id": b, "sort_order": 1, "version": 1},
        ],
        "working_videos": [],
    }
    with patch.object(project_archive, "R2_ENABLED", True), \
         patch.object(project_archive, "load_archive", return_value=archive):
        assert project_archive.restore_project(project_id, USER_ID) is False
    assert _clip_count(db_path, project_id) == 0


def test_restore_site_still_restores_one_clip_with_versions(db_path):
    """Version rows of ONE clip are not a second clip: restore still works."""
    from app.services import project_archive

    conn = _connect(db_path)
    cur = conn.cursor()
    a = _seed_raw_clip(cur, "A")
    cur.execute(
        "INSERT INTO projects (name, aspect_ratio, archived_at) "
        "VALUES ('Draft', '9:16', CURRENT_TIMESTAMP)")
    project_id = cur.lastrowid
    conn.commit()
    conn.close()

    archive = {
        "project": {"id": project_id, "name": "Draft", "aspect_ratio": "9:16",
                    "working_video_id": None},
        "working_clips": [
            {"id": 9101, "project_id": project_id, "raw_clip_id": a, "sort_order": 0, "version": 1},
            {"id": 9102, "project_id": project_id, "raw_clip_id": a, "sort_order": 0, "version": 2},
        ],
        "working_videos": [],
    }
    with patch.object(project_archive, "R2_ENABLED", True), \
         patch.object(project_archive, "load_archive", return_value=archive):
        assert project_archive.restore_project(project_id, USER_ID) is True
    assert _clip_count(db_path, project_id) == 2


# ---------------------------------------------------------------------------
# C3: deleted endpoints are gone (404/405) and nothing references them
# ---------------------------------------------------------------------------

DELETED_ROUTES = [
    ("POST", "/api/clips/projects/{project_id}/clips"),
    ("POST", "/api/clips/projects/{project_id}/clips/upload-with-metadata"),
    ("PUT", "/api/clips/projects/{project_id}/clips/reorder"),
    ("DELETE", "/api/clips/projects/{project_id}/clips/{clip_id}"),
    ("POST", "/api/export/multi-clip"),
]


@pytest.mark.parametrize("method,path", DELETED_ROUTES)
def test_deleted_route_is_not_registered(method, path):
    from app.main import app

    registered = {
        (m, r.path) for r in app.routes for m in (getattr(r, "methods", None) or ())
    }
    assert (method, path) not in registered


@pytest.mark.parametrize("method,url", [
    ("POST", "/api/clips/projects/1/clips"),
    ("POST", "/api/clips/projects/1/clips/upload-with-metadata"),
    ("DELETE", "/api/clips/projects/1/clips/2"),
    ("POST", "/api/export/multi-clip"),
])
def test_deleted_route_answers_404_or_405(method, url):
    """Route matching runs before auth and the handler, so an unregistered
    method/path pair answers 404/405 whatever the session."""
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app, headers={"X-User-ID": USER_ID})
    assert client.request(method, url).status_code in (404, 405)


def test_removed_symbols_are_gone():
    from app.routers import clips
    from app.routers.export import multi_clip
    from app.services import ffmpeg_service

    for name in ("add_clip_to_project", "upload_clip_with_metadata",
                 "reorder_clips", "remove_clip_from_project"):
        assert not hasattr(clips, name), name
    for name in ("export_multi_clip", "_run_multi_clip_background",
                 "concatenate_clips_with_transition", "create_chapter_metadata_file",
                 "add_chapters_to_video"):
        assert not hasattr(multi_clip, name), name
    for name in ("create_chapter_metadata_file", "add_chapters_to_video"):
        assert not hasattr(ffmpeg_service, name), name
    assert importlib.util.find_spec("app.services.transitions") is None


def test_zero_references_to_deleted_endpoints_and_helpers():
    """No code under src/ or scripts/ (incl. e2e and shell scripts) names a
    deleted route or helper. Excluded: frozen migration docstrings (history), the
    frontend test that asserts the app never posts /export/multi-clip, and a
    committed old e2e log."""
    pattern = (
        r"clips/reorder|upload-with-metadata|export/multi-clip|services\.transitions"
        r"|services/transitions|export_multi_clip|_run_multi_clip_background"
        r"|concatenate_clips_with_transition|add_chapters_to_video|create_chapter_metadata_file"
        r"|add_clip_to_project|upload_clip_with_metadata|remove_clip_from_project"
        r"|\breorder_clips\b|apply_transition"
    )
    result = subprocess.run(
        ["git", "grep", "-n", "-E", pattern, "--", "src", "scripts",
         ":!src/backend/app/migrations", ":!src/backend/tests/test_t11250_single_clip_backend.py",
         ":!src/backend/tests/.test_durations.json",
         ":!src/frontend/src/containers/ExportButtonContainer.renderOnly.test.jsx",
         ":!src/frontend/test-output.txt"],
        cwd=REPO_ROOT, capture_output=True, text=True,
    )
    assert result.returncode == 1, f"references remain:\n{result.stdout}"
