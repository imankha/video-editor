"""T6030 Part 2: the STRUCTURAL guard.

T5970 audited every profile_db `ADD COLUMN` by hand once. The next `ADD COLUMN`
someone writes reopens the exact same deploy->migrate-window hole (a hot read that
names a not-yet-migrated column -> `sqlite3.OperationalError: no such column` -> 500),
and nothing fails to warn them. This test makes the window a *tested property*: it
builds a real profile DB at a below-head schema WITH ROWS and drives every hot-path
read, asserting none raises `OperationalError` for a missing column.

Auto-extension decision (CLAUDE.md refactoring rule 6 -- greppable explicitness over
registry magic):
  The profile_db migrations cannot be run forward in a lightweight test (v002 already
  needs the Postgres pool + user/profile context; v017-v023 need R2), so we cannot
  DERIVE the below-head schema by replaying the registry. Instead we DROP an EXPLICIT,
  greppable set of the realistically-missing columns (`POST_V023_COLUMNS`) off a fresh
  head DB. Per T5970's audit the only columns that can be missing on a live prod DB are
  v024+ (prod is >= v18; profile_db v017-v023 add NO columns), so v023 is the floor.
  This does NOT auto-COVER a future v030 column, but `test_registry_head_is_audited`
  turns the next added migration RED with instructions -- so a new `ADD COLUMN` cannot
  land silently unguarded. That alarm is the durable half; the explicit list is the
  greppable half.
"""

import shutil
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import USER_DATA_BASE, ensure_database, get_database_path, get_db_connection
from app.migrations.profile_db import MIGRATIONS
from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id

TEST_PROFILE_ID = "testdefault"

# The floor below which no live prod DB can sit (T5970 audit: prod >= v18, and
# profile_db v017-v023 add NO columns). Everything a pending migration could add is v024+.
FLOOR_VERSION = 23

# The exact columns profile_db v024..head add, per table. Explicit + greppable ON PURPOSE
# (see the module docstring). Every entry here is DROPPED off a head DB to synthesize the
# below-head schema. When a new migration adds a column, extend this map AND bump
# HEAD_VERSION_AUDITED -- test_registry_head_is_audited enforces that you do.
POST_V023_COLUMNS = {
    "final_videos": [
        "poster_filename", "slowmo_section_start", "slowmo_section_end",  # v024, v025
        "poster_frame_time", "poster_source",                             # v032
    ],
    "games": ["shared_by", "source_profile_id", "source_game_id"],                       # v026, v030
    "working_videos": ["detections_data"],                                              # v027
    "export_jobs": ["stage", "output_key"],                                             # v028
    "working_clips": ["rotation"],                                                       # v029
    "projects": ["poster_marker_time"],                                                  # v032
    # v031 (T5725 reclassify teammate-tagged clips to Team) adds NO column -> nothing to guard.
    # (v030 belongs to the sibling T5800 branch, not present here; audit it on that merge.)
    # v033 (T5830 heal pre-T5810 moved-reel attribution) adds NO column -> nothing to guard.
    #   It rewrites final_videos.game_ids and inserts reference games rows via
    #   ensure_game_reference; every column it touches predates v024.
}
HEAD_VERSION_AUDITED = 33


def _cleanup(user_id: str) -> None:
    path = USER_DATA_BASE / user_id
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)


def _build_below_head_db(user_id: str) -> None:
    """Head schema on disk, then DROP every POST_V023 column and stamp user_version to
    the floor -- a faithful pre-v024 profile DB."""
    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    ensure_database()

    import sqlite3

    conn = sqlite3.connect(str(get_database_path()))
    for table, cols in POST_V023_COLUMNS.items():
        for col in cols:
            conn.execute(f"ALTER TABLE {table} DROP COLUMN {col}")
    conn.execute(f"PRAGMA user_version = {FLOOR_VERSION}")
    conn.commit()
    conn.close()


def _seed_rows(user_id: str, n: int = 2) -> dict:
    """Seed REAL rows into every table the hot reads touch (schema-only assertions miss
    row-time crashes -- memory reference_migration_runner_rowfactory). Returns key ids."""
    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO games (name, blake3_hash, status) VALUES ('Game', 'abc', 'ready')")
        game_id = cur.lastrowid
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', '9:16')")
        project_id = cur.lastrowid
        for i in range(n):
            cur.execute(
                "INSERT INTO raw_clips (filename, rating, game_id, video_sequence, end_time) "
                "VALUES (?, 5, ?, ?, ?)",
                (f"clip{i}.mp4", game_id, i, 10.0 + i),
            )
            cur.execute(
                "INSERT INTO working_clips (project_id, sort_order, version) VALUES (?, ?, 1)",
                (project_id, i),
            )
            cur.execute(
                "INSERT INTO working_videos (project_id, filename, version) VALUES (?, ?, 1)",
                (project_id, f"wv{i}.mp4"),
            )
            cur.execute(
                "INSERT INTO final_videos (project_id, filename, version, name, published_at) "
                "VALUES (?, ?, ?, 'Reel', CURRENT_TIMESTAMP)",
                (project_id, f"final{i}.mp4", i + 1),
            )
            cur.execute(
                "INSERT INTO export_jobs (id, project_id, type, status, input_data) "
                "VALUES (?, ?, 'overlay', 'complete', ?)",
                (f"job{i}", project_id, b"{}"),
            )
        cur.execute("INSERT OR IGNORE INTO achievements (key) VALUES ('watched_annotate_tutorial')")
        conn.commit()
    return {"game_id": game_id, "project_id": project_id}


@pytest.fixture
def below_head():
    user_id = f"test_t6030s_{uuid.uuid4().hex[:8]}"
    _build_below_head_db(user_id)
    ids = _seed_rows(user_id)
    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    yield {"user_id": user_id, **ids}
    _cleanup(user_id)


# --------------------------------------------------------------------------------------
# The durable alarm: a new migration must be audited into this test.
# --------------------------------------------------------------------------------------

def test_registry_head_is_audited():
    head = max(m.version for m in MIGRATIONS)
    assert head == HEAD_VERSION_AUDITED, (
        f"profile_db head is now v{head:03d}, but this migration-window guard was last "
        f"audited at v{HEAD_VERSION_AUDITED:03d}. If the new migration ADDs a column, add it to "
        f"POST_V023_COLUMNS, confirm every hot read that names it is column_exists-guarded, "
        f"then bump HEAD_VERSION_AUDITED. This is the structural warn T6030 exists to give."
    )


def test_below_head_db_is_actually_below_head(below_head):
    import sqlite3

    conn = sqlite3.connect(str(get_database_path()))
    for table, cols in POST_V023_COLUMNS.items():
        present = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        for col in cols:
            assert col not in present, f"{table}.{col} should be dropped"
    assert conn.execute("PRAGMA user_version").fetchone()[0] == FLOOR_VERSION
    conn.close()


# --------------------------------------------------------------------------------------
# Drive every hot-path read against the below-head DB. None may raise OperationalError.
# Each helper returns a coroutine or value; we only care that no missing-column 500 fires.
# --------------------------------------------------------------------------------------

def _run(coro_or_value):
    import asyncio
    import inspect

    if inspect.iscoroutine(coro_or_value):
        return asyncio.run(coro_or_value)
    return coro_or_value


def test_quests_check_all_steps(below_head):
    from app.routers.quests import _check_all_steps

    with get_db_connection() as conn:
        steps = _check_all_steps(below_head["user_id"], conn)
    assert isinstance(steps, dict)  # games.shared_by (v026) tolerated


def test_games_list(below_head):
    from app.routers.games import list_games, list_games_metadata

    _run(list_games_metadata())
    _run(list_games())


def test_projects_list(below_head):
    from app.routers.projects import list_projects

    _run(list_projects())


def test_clips_lists(below_head):
    from fastapi import BackgroundTasks

    from app.routers.clips import list_project_clips, list_raw_clips

    _run(list_raw_clips())
    _run(list_project_clips(below_head["project_id"], BackgroundTasks()))  # working_clips.rotation (v029)


def test_overlay_data(below_head):
    from app.routers.export.overlay import get_overlay_data

    _run(get_overlay_data(below_head["project_id"]))  # working_videos.detections_data (v027)
    # T5410: projects.poster_marker_time (v032) is read in the SAME response --
    # a below-head DB must not 500 on the new column either.
    #
    # NOTE: _finalize_overlay_export's OWN poster_marker_time guard is NOT
    # exercised here -- that function's INSERT already names other v024+
    # columns (poster_filename) unconditionally and was never a below-head-
    # tolerant "list" read this file's fixture set was built to cover (it's
    # covered by test_t6030_slowmo_migration_window.py's dedicated guard tests
    # instead). test_t5410_poster_selection.py covers the poster_marker_time
    # getter/setter's own column-guard directly.


def test_gallery_downloads(below_head):
    from app.routers.downloads import list_downloads

    _run(list_downloads())


def test_collections_summary(below_head):
    from app.routers.collections import collections_summary

    _run(collections_summary())


def test_exports_lists(below_head):
    from app.routers.exports import list_active_exports, list_recent_exports

    _run(list_active_exports())
    _run(list_recent_exports())  # export_jobs.stage/output_key (v028)
