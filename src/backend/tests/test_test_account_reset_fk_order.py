"""
Regression test for the admin "reset test account data" button's
delete order (app/services/test_account_reset.py _TABLES_IN_DELETE_ORDER).

This pins the exact bug an earlier offline script (scripts/reset_all_accounts.py)
got away with: its TABLES_TO_CLEAR order (raw_clips, projects, working_clips,
working_videos, final_videos, ...) deletes `projects` while `final_videos` rows
still reference it -- harmless there only because that script's bare
sqlite3.connect() never sets PRAGMA foreign_keys=ON. Every in-process
connection in this app DOES enforce FKs (test_fk_cascades.py), so porting that
order verbatim into the admin endpoint would raise IntegrityError on the very
first account that has a published reel. This test builds one profile DB
through the real schema (get_db_connection -> ensure_database) with exactly
that shape -- a final_video pointing at a project -- and proves the module's
actual delete order clears every target table without violating a single FK,
while the account's `games` row (preserved by design) survives untouched.
"""

import shutil
import sqlite3
import uuid

import pytest

from app.database import USER_DATA_BASE, get_db_connection
from app.profile_context import set_current_profile_id
from app.services import test_account_reset
from app.session_init import _init_cache
from app.user_context import set_current_user_id

# The order scripts/reset_all_accounts.py's TABLES_TO_CLEAR uses (projects
# before final_videos) -- safe there only because that script's bare
# sqlite3.connect() never enables PRAGMA foreign_keys. Pinned here as the
# negative case so this test module still fails if the real order regresses
# to this shape.
_NAIVE_BUGGY_ORDER = [
    "raw_clips", "projects", "working_clips", "working_videos",
    "final_videos", "export_jobs", "achievements",
    "before_after_tracks", "pending_uploads",
]

TEST_USER_ID = f"test_reset_fk_order_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "fe01ab23"


def setup_module():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    _init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}


def teardown_module():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    test_path = USER_DATA_BASE / TEST_USER_ID
    if test_path.exists():
        shutil.rmtree(test_path, ignore_errors=True)


def _seed_full_graph(cursor):
    """One row in every table the reset touches, wired so a naive delete
    order (projects before final_videos) would raise IntegrityError, plus one
    `games` row that must survive (it's deliberately NOT in the clear list)."""
    cursor.execute(
        "INSERT INTO games (name, blake3_hash) VALUES (?, ?)",
        ("Reset Test Game", f"hash_{uuid.uuid4().hex[:32]}"),
    )
    game_id = cursor.lastrowid

    cursor.execute(
        "INSERT INTO projects (name, aspect_ratio) VALUES (?, ?)",
        ("Reset Test Project", "9:16"),
    )
    project_id = cursor.lastrowid

    cursor.execute(
        "INSERT INTO raw_clips (filename, game_id, start_time, end_time) VALUES (?, ?, ?, ?)",
        ("clip.mp4", game_id, 0.0, 5.0),
    )
    cursor.execute(
        "INSERT INTO working_videos (project_id, filename) VALUES (?, ?)",
        (project_id, "working.mp4"),
    )
    cursor.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id) VALUES (?, (SELECT id FROM raw_clips LIMIT 1))",
        (project_id,),
    )
    # The load-bearing row: final_videos.project_id has NO cascade (plain
    # REFERENCES projects(id)), so `projects` cannot be deleted first.
    cursor.execute(
        "INSERT INTO final_videos (project_id, filename) VALUES (?, ?)",
        (project_id, "final.mp4"),
    )
    final_video_id = cursor.lastrowid
    cursor.execute(
        "INSERT INTO before_after_tracks (final_video_id, source_path, start_frame, end_frame) "
        "VALUES (?, 'raw.mp4', 0, 10)",
        (final_video_id,),
    )
    cursor.execute(
        "INSERT INTO export_jobs (id, project_id, type, status, input_data) VALUES (?, ?, 'framing', 'complete', '{}')",
        (f"job_{uuid.uuid4().hex[:8]}", project_id),
    )
    cursor.execute("INSERT INTO achievements (key) VALUES (?)", ("first_clip",))
    cursor.execute(
        "INSERT INTO pending_uploads (id, blake3_hash, file_size, original_filename, r2_upload_id) "
        "VALUES (?, ?, 1, 'raw.mp4', 'upload-1')",
        (f"pending_{uuid.uuid4().hex[:8]}", f"hash_{uuid.uuid4().hex[:32]}"),
    )
    return game_id


def test_delete_order_clears_everything_without_fk_violation_and_keeps_games():
    with get_db_connection() as conn:
        cursor = conn.cursor()
        game_id = _seed_full_graph(cursor)
        conn.commit()

        for table in test_account_reset._TABLES_IN_DELETE_ORDER:
            cursor.execute(f"DELETE FROM {table}")
        conn.commit()  # raises sqlite3.IntegrityError here if the order is wrong

        for table in test_account_reset._TABLES_IN_DELETE_ORDER:
            cursor.execute(f"SELECT COUNT(*) AS n FROM {table}")
            assert cursor.fetchone()["n"] == 0, f"{table} was not fully cleared"

        cursor.execute("SELECT COUNT(*) AS n FROM games WHERE id = ?", (game_id,))
        assert cursor.fetchone()["n"] == 1, "games must survive a data-only reset"


def test_naive_order_from_the_offline_script_violates_fk_on_this_connection():
    """Red/green pair for the test above: proves the bug this task fixed was
    real. The SAME seeded graph, deleted in scripts/reset_all_accounts.py's
    order, raises IntegrityError on THIS app's FK-enforcing connections --
    confirming _TABLES_IN_DELETE_ORDER's reordering (final_videos/
    before_after_tracks before projects) is load-bearing, not cosmetic."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        _seed_full_graph(cursor)
        conn.commit()

        with pytest.raises(sqlite3.IntegrityError):
            for table in _NAIVE_BUGGY_ORDER:
                cursor.execute(f"DELETE FROM {table}")
            conn.commit()
        conn.rollback()

        # Clean up for module teardown regardless of pass/fail above.
        for table in test_account_reset._TABLES_IN_DELETE_ORDER:
            cursor.execute(f"DELETE FROM {table}")
        conn.commit()
