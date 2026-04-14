"""
T1160 + T1170: Tests for cleanup_database_bloat pruning rules and VACUUM gate.

Covers:
  - working_clips pruning (keep latest version per identity)
  - before_after_tracks pruning (keep only tracks for current final_video)
  - modal_tasks pruning (terminal + older than 24h)
  - VACUUM gate: skipped when DB under threshold, runs when over

Run with: pytest src/backend/tests/test_cleanup_database_bloat.py -v
"""

import shutil
import sys
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

TEST_USER_ID = f"test_cleanup_bloat_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "ab12cd34"


def setup_module():
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache

    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    from app.database import USER_DATA_BASE
    from app.user_context import reset_user_id

    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)
    reset_user_id()


@pytest.fixture(autouse=True)
def clean_tables():
    """Wipe relevant tables before each test so rules compose cleanly."""
    from app.database import get_db_connection

    with get_db_connection() as conn:
        cur = conn.cursor()
        for table in (
            "before_after_tracks",
            "modal_tasks",
            "working_clips",
            "final_videos",
            "working_videos",
            "raw_clips",
            "projects",
        ):
            cur.execute(f"DELETE FROM {table}")
        conn.commit()
    yield


# --------------------------- Rule A: working_clips -----------------------------


def test_working_clips_prunes_old_versions_keeps_latest():
    """Three versions of the same identity → only highest survives."""
    from app.database import get_db_connection
    from app.services.project_archive import cleanup_database_bloat

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (id, name, aspect_ratio) VALUES (1, 'P', '16:9')")
        cur.execute(
            "INSERT INTO raw_clips (id, filename, rating, end_time) VALUES (1, 'a.mp4', 5, 12.5)"
        )
        for v in (1, 2, 3):
            cur.execute(
                "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) "
                "VALUES (1, 1, ?, 0)",
                (v,),
            )
        conn.commit()

    result = cleanup_database_bloat()
    assert result["working_clips_pruned"] == 2

    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT version FROM working_clips WHERE raw_clip_id = 1"
        ).fetchall()
    assert [r["version"] for r in rows] == [3]


def test_working_clips_singleton_survives():
    """Only one version exists — nothing pruned."""
    from app.database import get_db_connection
    from app.services.project_archive import cleanup_database_bloat

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (id, name, aspect_ratio) VALUES (1, 'P', '16:9')")
        cur.execute(
            "INSERT INTO raw_clips (id, filename, rating, end_time) VALUES (1, 'a.mp4', 5, 12.5)"
        )
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version) VALUES (1, 1, 1)"
        )
        conn.commit()

    result = cleanup_database_bloat()
    assert result["working_clips_pruned"] == 0

    with get_db_connection() as conn:
        count = conn.execute("SELECT COUNT(*) as c FROM working_clips").fetchone()["c"]
    assert count == 1


def test_working_clips_multi_identity_keeps_one_per_identity():
    """Two raw_clips in one project, 2 versions each → 2 rows survive (latest each)."""
    from app.database import get_db_connection
    from app.services.project_archive import cleanup_database_bloat

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (id, name, aspect_ratio) VALUES (1, 'P', '16:9')")
        cur.execute(
            "INSERT INTO raw_clips (id, filename, rating, end_time) VALUES (1, 'a.mp4', 5, 10.0)"
        )
        cur.execute(
            "INSERT INTO raw_clips (id, filename, rating, end_time) VALUES (2, 'b.mp4', 5, 20.0)"
        )
        for raw_id in (1, 2):
            for v in (1, 2):
                cur.execute(
                    "INSERT INTO working_clips (project_id, raw_clip_id, version) "
                    "VALUES (1, ?, ?)",
                    (raw_id, v),
                )
        conn.commit()

    result = cleanup_database_bloat()
    assert result["working_clips_pruned"] == 2

    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT raw_clip_id, version FROM working_clips ORDER BY raw_clip_id"
        ).fetchall()
    assert [(r["raw_clip_id"], r["version"]) for r in rows] == [(1, 2), (2, 2)]


# ----------------------- Rule B: before_after_tracks ---------------------------


def test_before_after_tracks_prunes_non_current_final_video():
    """Tracks for old final_video deleted; tracks for current survive."""
    from app.database import get_db_connection
    from app.services.project_archive import cleanup_database_bloat

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (id, name, aspect_ratio) VALUES (1, 'P', '16:9')")
        cur.execute(
            "INSERT INTO final_videos (id, project_id, filename, version) "
            "VALUES (10, 1, 'v1.mp4', 1)"
        )
        cur.execute(
            "INSERT INTO final_videos (id, project_id, filename, version) "
            "VALUES (20, 1, 'v2.mp4', 2)"
        )
        cur.execute("UPDATE projects SET final_video_id = 20 WHERE id = 1")
        for fv_id in (10, 20):
            cur.execute(
                "INSERT INTO before_after_tracks "
                "(final_video_id, source_path, start_frame, end_frame) "
                "VALUES (?, 'x', 0, 100)",
                (fv_id,),
            )
        conn.commit()

    result = cleanup_database_bloat()
    assert result["before_after_tracks_pruned"] == 1

    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT final_video_id FROM before_after_tracks"
        ).fetchall()
    assert [r["final_video_id"] for r in rows] == [20]


# ----------------------------- Rule C: modal_tasks -----------------------------


def test_modal_tasks_prunes_old_terminal_rows():
    """Terminal status + completed_at older than 24h → deleted."""
    from app.database import get_db_connection
    from app.services.project_archive import cleanup_database_bloat

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO modal_tasks (task_type, status, params, completed_at) "
            "VALUES ('upscale', 'complete', '{}', datetime('now', '-2 days'))"
        )
        conn.commit()

    result = cleanup_database_bloat()
    assert result["modal_tasks_pruned"] == 1

    with get_db_connection() as conn:
        count = conn.execute("SELECT COUNT(*) as c FROM modal_tasks").fetchone()["c"]
    assert count == 0


def test_modal_tasks_keeps_recent_terminal_rows():
    """Terminal + completed_at within 24h → survives."""
    from app.database import get_db_connection
    from app.services.project_archive import cleanup_database_bloat

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO modal_tasks (task_type, status, params, completed_at) "
            "VALUES ('upscale', 'error', '{}', datetime('now', '-2 hours'))"
        )
        conn.commit()

    result = cleanup_database_bloat()
    assert result["modal_tasks_pruned"] == 0

    with get_db_connection() as conn:
        count = conn.execute("SELECT COUNT(*) as c FROM modal_tasks").fetchone()["c"]
    assert count == 1


def test_modal_tasks_keeps_old_running_rows():
    """Non-terminal status → never pruned regardless of age."""
    from app.database import get_db_connection
    from app.services.project_archive import cleanup_database_bloat

    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO modal_tasks (task_type, status, params, created_at) "
            "VALUES ('upscale', 'running', '{}', datetime('now', '-5 days'))"
        )
        conn.commit()

    result = cleanup_database_bloat()
    assert result["modal_tasks_pruned"] == 0

    with get_db_connection() as conn:
        count = conn.execute("SELECT COUNT(*) as c FROM modal_tasks").fetchone()["c"]
    assert count == 1


# ------------------------------- VACUUM gate (T1170) ---------------------------


class _FakePath:
    """Minimal stand-in for a Path, returning a controlled stat().st_size."""

    def __init__(self, size_bytes):
        self._size = size_bytes

    def exists(self):
        return True

    def stat(self):
        class _S:
            pass

        s = _S()
        s.st_size = self._size
        return s


def _run_cleanup_observing_vacuum(fake_size_bytes):
    """Run cleanup with get_database_path stubbed and VACUUM calls counted."""
    from app.services import project_archive
    from app.database import get_db_connection as real_get_conn

    observed = {"count": 0}

    class WrappedConn:
        def __init__(self, inner):
            self._inner = inner

        def __enter__(self):
            self._ctx = self._inner.__enter__()
            return self

        def __exit__(self, *a):
            return self._inner.__exit__(*a)

        def cursor(self):
            return self._ctx.cursor()

        def commit(self):
            return self._ctx.commit()

        def execute(self, sql, *args, **kw):
            if sql.strip().upper().startswith("VACUUM"):
                observed["count"] += 1
                return None  # don't actually VACUUM in tests
            return self._ctx.execute(sql, *args, **kw)

    def wrapped_get_conn():
        return WrappedConn(real_get_conn())

    with patch.object(project_archive, "get_db_connection", wrapped_get_conn), \
         patch.object(project_archive, "get_database_path", lambda: _FakePath(fake_size_bytes)):
        project_archive.cleanup_database_bloat()

    return observed["count"]


def test_vacuum_skipped_when_under_threshold():
    """Small DB → VACUUM must not execute."""
    assert _run_cleanup_observing_vacuum(50 * 1024) == 0


def test_vacuum_runs_when_over_threshold():
    """Large DB → VACUUM executes exactly once."""
    assert _run_cleanup_observing_vacuum(500 * 1024) == 1
