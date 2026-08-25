"""
T7600: orphan raw_clips/ detection (scripts/cleanup_orphan_raw_clips.py).

The expiry-sweep dup-export bug left R2 objects under `raw_clips/` that no current
`raw_clips.filename` points at. The cleanup script's detection must report exactly
those orphans (dry-run) and never delete anything while scanning.
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
    """)
    # Two clips point at their CURRENT extracts; those are referenced (not orphans).
    conn.execute("INSERT INTO raw_clips (filename, rating) VALUES ('auto_1_1_current.mp4', 5)")
    conn.execute("INSERT INTO raw_clips (filename, rating) VALUES ('upload_keepme.mp4', 5)")
    conn.execute("INSERT INTO raw_clips (filename, rating) VALUES (NULL, 5)")  # draft, no extract
    conn.commit()
    conn.close()

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", {USER_ID}), \
         patch("app.database.R2_ENABLED", False):
        yield db_path


def test_scan_reports_only_unreferenced_objects(profile_db):
    """Two prior waves left `auto_..._wave1/2.mp4` orphaned; the current pointer
    (`auto_1_1_current.mp4`) and an uploaded clip are referenced and must be kept."""
    r2_objects = [
        ("raw_clips/auto_1_1_current.mp4", 1000),   # referenced -> keep
        ("raw_clips/upload_keepme.mp4", 2000),      # referenced -> keep
        ("raw_clips/auto_1_1_wave1.mp4", 3000),     # orphan (overwritten wave 1)
        ("raw_clips/auto_1_1_wave2.mp4", 4000),     # orphan (overwritten wave 2)
    ]
    with patch.object(cleanup, "_list_raw_clip_objects", return_value=r2_objects), \
         patch.object(cleanup, "delete_from_r2", create=True) as mock_delete:
        orphans = cleanup._scan_profile(USER_ID)

    orphan_paths = {p for p, _ in orphans}
    assert orphan_paths == {"raw_clips/auto_1_1_wave1.mp4", "raw_clips/auto_1_1_wave2.mp4"}
    assert sum(size for _, size in orphans) == 7000  # bytes-reclaimed estimate
    mock_delete.assert_not_called()  # scanning never deletes


def test_scan_empty_when_all_referenced(profile_db):
    r2_objects = [
        ("raw_clips/auto_1_1_current.mp4", 1000),
        ("raw_clips/upload_keepme.mp4", 2000),
    ]
    with patch.object(cleanup, "_list_raw_clip_objects", return_value=r2_objects):
        assert cleanup._scan_profile(USER_ID) == []
