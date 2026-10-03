"""
T11430 -- v056 profile_db migration: add projects.source_raw_clip_id (INTEGER,
FK -> raw_clips(id) ON DELETE SET NULL) + projects.highlight_ordinal (INTEGER)
and backfill both from the design doc's three association chains
(docs/plans/tasks/T11430-design.md, section 5.1.1):

  (a) legacy single `raw_clips.auto_project_id` pointer.
  (b) published/orphaned pointer: no working_clips survive (archived on
      publish), no auto_project_id either, but final_videos.source_clip_id
      still chains back to the raw_clip.
  (c) mixed vertical/horizontal history: two projects for the SAME raw_clip,
      one per orientation (projects.aspect_ratio '9:16' vs '16:9'), each gets
      an independent per-orientation highlight_ordinal counter starting at 1.

Written test-first (Stage 3): expected to FAIL until
app/migrations/profile_db/v056_project_source_raw_clip.py exists (import
error is the intended red reason for every test in this module).

Modeled on tests/test_t8070_migration_v049.py's harness pattern: build a
real pre-v056 profile.sqlite with tuple row factory (mirrors the migration
runner), run the migration's `.up(conn)` directly, assert on resulting rows.
"""

import shutil
import sqlite3
import uuid

from app.migrations.profile_db.v056_project_source_raw_clip import (
    V056ProjectSourceRawClip,
)
from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id


def _make_pre_v056_db(tmp_path):
    """projects WITHOUT source_raw_clip_id/highlight_ordinal, tuple row
    factory (mirrors the migration runner). Minimal schema for the backfill
    joins across raw_clips / working_clips / final_videos."""
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
            aspect_ratio TEXT NOT NULL DEFAULT '9:16',
            working_video_id INTEGER,
            final_video_id INTEGER,
            archived_at TIMESTAMP DEFAULT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            raw_clip_id INTEGER
        )
    """)
    conn.execute("""
        CREATE TABLE final_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            source_clip_id INTEGER,
            aspect_ratio TEXT,
            published_at TIMESTAMP,
            clip_count INTEGER
        )
    """)
    conn.commit()
    return conn


def test_adds_both_columns_when_missing(tmp_path):
    conn = _make_pre_v056_db(tmp_path)
    cols_before = {row[1] for row in conn.execute("PRAGMA table_info(projects)").fetchall()}
    assert "source_raw_clip_id" not in cols_before
    assert "highlight_ordinal" not in cols_before

    V056ProjectSourceRawClip().up(conn)

    cols_after = {row[1] for row in conn.execute("PRAGMA table_info(projects)").fetchall()}
    assert "source_raw_clip_id" in cols_after
    assert "highlight_ordinal" in cols_after


def test_backfill_legacy_single_auto_project_id(tmp_path):
    """(a) A project linked only via raw_clips.auto_project_id gets
    source_raw_clip_id set to that raw_clip's id."""
    conn = _make_pre_v056_db(tmp_path)
    conn.execute("INSERT INTO projects (id, aspect_ratio) VALUES (1, '9:16')")
    conn.execute(
        "INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (1, 2.5, 8.0, 1)"
    )
    conn.commit()

    V056ProjectSourceRawClip().up(conn)

    row = conn.execute("SELECT source_raw_clip_id FROM projects WHERE id = 1").fetchone()
    assert row == (1,), f"expected project 1 backfilled to raw_clip 1, got {row}"


def test_backfill_published_orphaned_pointer_via_final_videos(tmp_path):
    """(b) A project with NO working_clips rows (archived on publish) and NO
    auto_project_id pointing at it, but with a final_videos row whose
    source_clip_id points at the raw_clip, gets source_raw_clip_id backfilled
    via that chain."""
    conn = _make_pre_v056_db(tmp_path)
    # Project is archived (publish archives it) and NOT pointed at by
    # raw_clips.auto_project_id (it was repointed/orphaned, per design doc §2).
    conn.execute(
        "INSERT INTO projects (id, aspect_ratio, final_video_id, archived_at) "
        "VALUES (1, '9:16', 500, CURRENT_TIMESTAMP)"
    )
    conn.execute(
        "INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (1, 4.0, 9.0, NULL)"
    )
    # NO working_clips row for project 1 (deleted by project_archive.archive_project).
    conn.execute(
        "INSERT INTO final_videos (id, project_id, source_clip_id, aspect_ratio, published_at, clip_count) "
        "VALUES (500, 1, 1, '9:16', CURRENT_TIMESTAMP, 1)"
    )
    conn.commit()

    V056ProjectSourceRawClip().up(conn)

    row = conn.execute("SELECT source_raw_clip_id FROM projects WHERE id = 1").fetchone()
    assert row == (1,), (
        f"published/orphaned project must be relinked via final_videos.source_clip_id, got {row}"
    )


def test_backfill_mixed_orientation_gets_independent_ordinals(tmp_path):
    """(c) Two projects for the SAME raw_clip, one per orientation, each get
    highlight_ordinal=1 within their own orientation (independent counters)."""
    conn = _make_pre_v056_db(tmp_path)
    conn.execute("INSERT INTO projects (id, aspect_ratio) VALUES (1, '9:16')")
    conn.execute("INSERT INTO projects (id, aspect_ratio) VALUES (2, '16:9')")
    conn.execute(
        "INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (1, 0.0, 5.0, NULL)"
    )
    # Both projects link to raw_clip 1 via working_clips (in-progress link).
    conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (1, 1)")
    conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (2, 1)")
    conn.commit()

    V056ProjectSourceRawClip().up(conn)

    row1 = conn.execute(
        "SELECT source_raw_clip_id, highlight_ordinal FROM projects WHERE id = 1"
    ).fetchone()
    row2 = conn.execute(
        "SELECT source_raw_clip_id, highlight_ordinal FROM projects WHERE id = 2"
    ).fetchone()
    assert row1 == (1, 1), f"vertical project should be ordinal 1 within its own orientation, got {row1}"
    assert row2 == (1, 1), f"horizontal project should be ordinal 1 within its own orientation, got {row2}"


def test_backfill_two_same_orientation_versions_get_sequential_ordinals(tmp_path):
    """Two projects, same raw_clip, same orientation ('9:16') -> ordinals 1
    and 2 (lowest project id first), proving the per-orientation counter
    actually increments rather than always landing on 1."""
    conn = _make_pre_v056_db(tmp_path)
    conn.execute("INSERT INTO projects (id, aspect_ratio) VALUES (1, '9:16')")
    conn.execute("INSERT INTO projects (id, aspect_ratio) VALUES (2, '9:16')")
    conn.execute(
        "INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (1, 0.0, 5.0, NULL)"
    )
    conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (1, 1)")
    conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (2, 1)")
    conn.commit()

    V056ProjectSourceRawClip().up(conn)

    row1 = conn.execute("SELECT highlight_ordinal FROM projects WHERE id = 1").fetchone()
    row2 = conn.execute("SELECT highlight_ordinal FROM projects WHERE id = 2").fetchone()
    assert row1 == (1,)
    assert row2 == (2,)


def test_idempotent_rerun_does_not_double_increment(tmp_path):
    """Running the migration twice produces the same result -- no
    double-increment of highlight_ordinal, no duplicate columns."""
    conn = _make_pre_v056_db(tmp_path)
    conn.execute("INSERT INTO projects (id, aspect_ratio) VALUES (1, '9:16')")
    conn.execute("INSERT INTO projects (id, aspect_ratio) VALUES (2, '9:16')")
    conn.execute(
        "INSERT INTO raw_clips (id, start_time, end_time, auto_project_id) VALUES (1, 0.0, 5.0, NULL)"
    )
    conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (1, 1)")
    conn.execute("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (2, 1)")
    conn.commit()

    V056ProjectSourceRawClip().up(conn)
    V056ProjectSourceRawClip().up(conn)  # must not raise / not duplicate / not re-increment

    cols = [row[1] for row in conn.execute("PRAGMA table_info(projects)").fetchall()]
    assert cols.count("source_raw_clip_id") == 1
    assert cols.count("highlight_ordinal") == 1

    row1 = conn.execute(
        "SELECT source_raw_clip_id, highlight_ordinal FROM projects WHERE id = 1"
    ).fetchone()
    row2 = conn.execute(
        "SELECT source_raw_clip_id, highlight_ordinal FROM projects WHERE id = 2"
    ).fetchone()
    assert row1 == (1, 1), f"re-run must not change the first project's ordinal, got {row1}"
    assert row2 == (1, 2), f"re-run must not double-increment the second project's ordinal, got {row2}"


def test_project_with_no_association_chain_stays_null(tmp_path):
    """A project with no auto_project_id pointer, no working_clips, and no
    final_videos row has nothing to backfill from -- stays NULL (never
    guessed)."""
    conn = _make_pre_v056_db(tmp_path)
    conn.execute("INSERT INTO projects (id, aspect_ratio) VALUES (1, '9:16')")
    conn.commit()

    V056ProjectSourceRawClip().up(conn)

    row = conn.execute("SELECT source_raw_clip_id FROM projects WHERE id = 1").fetchone()
    assert row == (None,)


def test_noop_on_missing_projects_table(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V056ProjectSourceRawClip().up(conn)  # must not raise


def test_registered_in_profile_db_migrations():
    from app.migrations.profile_db import MIGRATIONS

    versions = [m.version for m in MIGRATIONS]
    assert 56 in versions, "v056 must be registered in profile_db MIGRATIONS"


def test_fresh_ensure_database_already_has_the_columns(tmp_path):
    """A fresh deploy's DDL must include both columns directly (fresh DBs
    don't run migrations)."""
    from app.database import USER_DATA_BASE, ensure_database, get_database_path

    user_id = f"test_v056_fresh_{uuid.uuid4().hex[:8]}"
    try:
        set_current_user_id(user_id)
        set_current_profile_id("testdefault")
        ensure_database()

        conn = sqlite3.connect(str(get_database_path()))
        cols = {row[1] for row in conn.execute("PRAGMA table_info(projects)").fetchall()}
        conn.close()
        assert "source_raw_clip_id" in cols
        assert "highlight_ordinal" in cols
    finally:
        path = USER_DATA_BASE / user_id
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
