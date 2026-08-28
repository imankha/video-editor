"""
T7600 / T7830: orphan raw_clips/ detection (scripts/cleanup_orphan_raw_clips.py).

The expiry-sweep dup-export bug left R2 objects under `raw_clips/` that no current
DB pointer references. The cleanup script's detection must:
  - report exactly the sweep-signature (`auto_`) orphans (dry-run) and never delete
    anything while scanning;
  - treat BOTH `raw_clips.filename` AND `working_clips.uploaded_filename` as live
    references (T7830 — the latter is where uploaded multi-clip sources live under
    raw_clips/; omitting it would flag live uploads as orphans);
  - keep any unreferenced NON-`auto_` object out of the deletion set (report-only).
"""

import importlib.util
import sqlite3
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

USER_ID = "test-user-orphan"
PROFILE_ID = "testdefault"

# Import the standalone script as a module.
_SCRIPT = Path(__file__).parent.parent.parent.parent / "scripts" / "cleanup_orphan_raw_clips.py"
_spec = importlib.util.spec_from_file_location("cleanup_orphan_raw_clips", _SCRIPT)
cleanup = importlib.util.module_from_spec(_spec)
sys.modules["cleanup_orphan_raw_clips"] = cleanup
_spec.loader.exec_module(cleanup)


@pytest.fixture
def profile_db(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    db_dir = tmp_path / USER_ID / "profiles" / PROFILE_ID
    db_dir.mkdir(parents=True)
    db_path = db_dir / "profile.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.executescript("""
        CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            rating INTEGER
        );
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            uploaded_filename TEXT,
            version INTEGER DEFAULT 1
        );
    """)
    # Two clips point at their CURRENT extracts; those are referenced (not orphans).
    conn.execute("INSERT INTO raw_clips (filename, rating) VALUES ('auto_1_1_current.mp4', 5)")
    conn.execute("INSERT INTO raw_clips (filename, rating) VALUES ('upload_keepme.mp4', 5)")
    conn.execute("INSERT INTO raw_clips (filename, rating) VALUES (NULL, 5)")  # draft, no extract
    # A user-uploaded multi-clip source lives under raw_clips/ but is referenced
    # ONLY via working_clips.uploaded_filename (T7830 regression guard).
    conn.execute("INSERT INTO working_clips (project_id, uploaded_filename) VALUES (1, 'deadbeef.mp4')")
    conn.commit()
    conn.close()

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", {USER_ID}), \
         patch("app.database.R2_ENABLED", False):
        yield db_path


def test_scan_reports_only_unreferenced_sweep_objects(profile_db):
    """Two prior waves left `auto_..._wave1/2.mp4` orphaned; the current pointer
    (`auto_1_1_current.mp4`) and an uploaded clip are referenced and must be kept."""
    r2_objects = [
        ("raw_clips/auto_1_1_current.mp4", 1000),   # referenced -> keep
        ("raw_clips/upload_keepme.mp4", 2000),      # referenced -> keep
        ("raw_clips/auto_1_1_wave1.mp4", 3000),     # orphan (overwritten wave 1)
        ("raw_clips/auto_1_1_wave2.mp4", 4000),     # orphan (overwritten wave 2)
    ]
    with patch.object(cleanup, "list_raw_clip_objects", return_value=r2_objects), \
         patch.object(cleanup, "delete_from_r2", create=True) as mock_delete:
        sweep_orphans, other = cleanup._scan_profile(USER_ID)

    orphan_paths = {p for p, _ in sweep_orphans}
    assert orphan_paths == {"raw_clips/auto_1_1_wave1.mp4", "raw_clips/auto_1_1_wave2.mp4"}
    assert sum(size for _, size in sweep_orphans) == 7000  # bytes-reclaimed estimate
    assert other == []
    mock_delete.assert_not_called()  # scanning never deletes


def test_uploaded_filename_reference_is_not_an_orphan(profile_db):
    """T7830 regression: an object referenced ONLY via working_clips.uploaded_filename
    must NOT be flagged — the live multi-clip export path downloads it from
    raw_clips/{uploaded_filename}. Deleting it would destroy live user footage."""
    r2_objects = [
        ("raw_clips/deadbeef.mp4", 5000),           # referenced via working_clips
        ("raw_clips/auto_9_9_orphan.mp4", 6000),    # true sweep orphan
    ]
    with patch.object(cleanup, "list_raw_clip_objects", return_value=r2_objects):
        sweep_orphans, other = cleanup._scan_profile(USER_ID)

    assert {p for p, _ in sweep_orphans} == {"raw_clips/auto_9_9_orphan.mp4"}
    # The uploaded source is referenced -> appears in neither list.
    assert "raw_clips/deadbeef.mp4" not in {p for p, _ in sweep_orphans}
    assert "raw_clips/deadbeef.mp4" not in {p for p, _ in other}


def test_unreferenced_non_sweep_object_is_review_only(profile_db):
    """An unreferenced object that does NOT match the sweep `auto_` signature is
    reported separately and is never a deletion candidate."""
    r2_objects = [
        ("raw_clips/auto_1_1_wave1.mp4", 3000),     # sweep orphan -> deletion candidate
        ("raw_clips/mystery_uuid.mp4", 9000),       # unreferenced but NOT auto_ -> review only
    ]
    with patch.object(cleanup, "list_raw_clip_objects", return_value=r2_objects):
        sweep_orphans, other = cleanup._scan_profile(USER_ID)

    assert {p for p, _ in sweep_orphans} == {"raw_clips/auto_1_1_wave1.mp4"}
    assert {p for p, _ in other} == {"raw_clips/mystery_uuid.mp4"}


def test_scan_empty_when_all_referenced(profile_db):
    r2_objects = [
        ("raw_clips/auto_1_1_current.mp4", 1000),
        ("raw_clips/upload_keepme.mp4", 2000),
        ("raw_clips/deadbeef.mp4", 5000),
    ]
    with patch.object(cleanup, "list_raw_clip_objects", return_value=r2_objects):
        assert cleanup._scan_profile(USER_ID) == ([], [])


def test_classify_objects_pure():
    """Pure classifier: referenced dropped, auto_ -> sweep, others -> review."""
    referenced = {"keep.mp4", "auto_keep.mp4"}
    objects = [
        ("raw_clips/keep.mp4", 1),
        ("raw_clips/auto_keep.mp4", 2),      # referenced auto_ -> dropped
        ("raw_clips/auto_gone.mp4", 3),      # unreferenced auto_ -> sweep
        ("raw_clips/other.mp4", 4),          # unreferenced non-auto -> review
    ]
    sweep, other = cleanup.classify_objects(referenced, objects)
    assert sweep == [("raw_clips/auto_gone.mp4", 3)]
    assert other == [("raw_clips/other.mp4", 4)]
