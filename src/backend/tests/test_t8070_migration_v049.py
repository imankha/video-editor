"""
T8070 — v049 profile_db migration: add raw_clips.reel_source_start_time /
reel_source_end_time (REAL, nullable) AND backfill produced reels.

Q1 (user decision) rejected a runtime self-heal in favor of a migration that
MAKES the data correct: every raw_clip belonging to a PRODUCED reel (a project
with a working_video or final_video) gets its snapshot set to that clip's OWN
current start/end at migration time. After it runs, reel_source_* is NULL ONLY
for clips with no produced reel.

Two backfill statements:
  1. join over working_clips.raw_clip_id -> produced project (covers single-clip
     seed, multi-clip added clips, AND user-created reels with no auto_project_id).
  2. auto_project_id -> produced project, for pruned-published reels whose
     working_clips no longer exist (statement 1's join misses them).

Written test-first (Stage 3): expected to FAIL until
app/migrations/profile_db/v049_raw_clips_reel_source_window.py exists.
"""

import shutil
import sqlite3
import uuid

from app.migrations.profile_db.v049_raw_clips_reel_source_window import (
    V049RawClipsReelSourceWindow,
)
from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id


def _make_pre_v049_db(tmp_path):
    """raw_clips WITHOUT the reel_source_* columns, tuple row factory (mirrors the
    migration runner). Minimal schema for the backfill joins."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory -> tuples
    conn.execute("""
        CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time REAL,
            end_time REAL,
            auto_project_id INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            working_video_id INTEGER,
            final_video_id INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            raw_clip_id INTEGER
        )
    """)
    conn.commit()
    return conn


def test_adds_both_columns_when_missing(tmp_path):
    conn = _make_pre_v049_db(tmp_path)
    cols_before = {row[1] for row in conn.execute("PRAGMA table_info(raw_clips)").fetchall()}
    assert "reel_source_start_time" not in cols_before
    assert "reel_source_end_time" not in cols_before

    V049RawClipsReelSourceWindow().up(conn)

    cols_after = {row[1] for row in conn.execute("PRAGMA table_info(raw_clips)").fetchall()}
    assert "reel_source_start_time" in cols_after
    assert "reel_source_end_time" in cols_after


def test_backfill_single_clip_auto_draft_seed(tmp_path):
    """A produced single-clip auto draft's seed clip is backfilled to its window."""
    conn = _make_pre_v049_db(tmp_path)
    conn.execute("INSERT INTO projects (id, working_video_id) VALUES (1, 100)")  # produced
    conn.execute("INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (1, 2.5, 8.0, 1)")
    conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (1, 1)")
    conn.commit()

    V049RawClipsReelSourceWindow().up(conn)

    row = conn.execute(
        "SELECT reel_source_start_time, reel_source_end_time FROM raw_clips WHERE id = 1"
    ).fetchone()
    assert row == (2.5, 8.0)


def test_backfill_multiclip_member_without_auto_project_id(tmp_path):
    """A clip ADDED to a produced reel (auto_project_id NULL) is still backfilled
    via the working_clips.raw_clip_id join (statement 1)."""
    conn = _make_pre_v049_db(tmp_path)
    conn.execute("INSERT INTO projects (id, final_video_id) VALUES (1, 200)")  # produced
    # seed clip (has auto_project_id) + added clip (auto_project_id NULL)
    conn.execute("INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (1, 0.0, 5.0, 1)")
    conn.execute("INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (2, 10.0, 13.0, NULL)")
    conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (1, 1)")
    conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (1, 2)")
    conn.commit()

    V049RawClipsReelSourceWindow().up(conn)

    r1 = conn.execute("SELECT reel_source_start_time, reel_source_end_time FROM raw_clips WHERE id = 1").fetchone()
    r2 = conn.execute("SELECT reel_source_start_time, reel_source_end_time FROM raw_clips WHERE id = 2").fetchone()
    assert r1 == (0.0, 5.0)
    assert r2 == (10.0, 13.0)  # added clip backfilled despite NULL auto_project_id


def test_backfill_pruned_published_seed_via_auto_project_id(tmp_path):
    """A produced reel whose working_clips were pruned (published) has its seed
    clip backfilled via statement 2 (auto_project_id), since statement 1's join
    finds no working_clips row."""
    conn = _make_pre_v049_db(tmp_path)
    conn.execute("INSERT INTO projects (id, final_video_id) VALUES (1, 300)")  # produced, pruned
    conn.execute("INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (1, 4.0, 9.0, 1)")
    # NO working_clips row for project 1
    conn.commit()

    V049RawClipsReelSourceWindow().up(conn)

    row = conn.execute(
        "SELECT reel_source_start_time, reel_source_end_time FROM raw_clips WHERE id = 1"
    ).fetchone()
    assert row == (4.0, 9.0)


def test_unproduced_reel_stays_null(tmp_path):
    """A reel draft with no working_video AND no final_video is NOT backfilled."""
    conn = _make_pre_v049_db(tmp_path)
    conn.execute("INSERT INTO projects (id) VALUES (1)")  # unproduced: both video ids NULL
    conn.execute("INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (1, 1.0, 3.0, 1)")
    conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (1, 1)")
    conn.commit()

    V049RawClipsReelSourceWindow().up(conn)

    row = conn.execute(
        "SELECT reel_source_start_time, reel_source_end_time FROM raw_clips WHERE id = 1"
    ).fetchone()
    assert row == (None, None)


def test_clip_with_no_reel_stays_null(tmp_path):
    """A clip with no linked reel at all keeps NULL (the "no reel" meaning)."""
    conn = _make_pre_v049_db(tmp_path)
    conn.execute("INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (1, 1.0, 2.0, NULL)")
    conn.commit()

    V049RawClipsReelSourceWindow().up(conn)

    row = conn.execute(
        "SELECT reel_source_start_time, reel_source_end_time FROM raw_clips WHERE id = 1"
    ).fetchone()
    assert row == (None, None)


def test_idempotent_rerun(tmp_path):
    """Re-running adds no duplicate column and re-sets the same backfill values."""
    conn = _make_pre_v049_db(tmp_path)
    conn.execute("INSERT INTO projects (id, working_video_id) VALUES (1, 100)")
    conn.execute("INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (1, 2.5, 8.0, 1)")
    conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (1, 1)")
    conn.commit()

    V049RawClipsReelSourceWindow().up(conn)
    V049RawClipsReelSourceWindow().up(conn)  # must not raise / not duplicate

    cols = [row[1] for row in conn.execute("PRAGMA table_info(raw_clips)").fetchall()]
    assert cols.count("reel_source_start_time") == 1
    assert cols.count("reel_source_end_time") == 1
    row = conn.execute("SELECT reel_source_start_time, reel_source_end_time FROM raw_clips WHERE id = 1").fetchone()
    assert row == (2.5, 8.0)


def test_noop_on_missing_raw_clips_table(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V049RawClipsReelSourceWindow().up(conn)  # must not raise


def test_registered_in_profile_db_migrations():
    from app.migrations.profile_db import MIGRATIONS

    versions = [m.version for m in MIGRATIONS]
    assert 49 in versions, "v049 must be registered in profile_db MIGRATIONS"


def test_fresh_ensure_database_already_has_the_columns(tmp_path):
    """A fresh deploy's DDL must include both columns directly (fresh DBs don't
    run migrations)."""
    from app.database import USER_DATA_BASE, ensure_database, get_database_path

    user_id = f"test_v049_fresh_{uuid.uuid4().hex[:8]}"
    try:
        set_current_user_id(user_id)
        set_current_profile_id("testdefault")
        ensure_database()

        conn = sqlite3.connect(str(get_database_path()))
        cols = {row[1] for row in conn.execute("PRAGMA table_info(raw_clips)").fetchall()}
        conn.close()
        assert "reel_source_start_time" in cols
        assert "reel_source_end_time" in cols
    finally:
        path = USER_DATA_BASE / user_id
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
