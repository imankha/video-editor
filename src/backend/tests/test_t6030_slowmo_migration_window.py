"""T6030 Part 1: the v025 residual.

`profile_db/v025_freeze_slowmo_section.py` adds `final_videos.slowmo_section_start` /
`slowmo_section_end`. At the time this was written, migrations ran manually
(POST /api/admin/migrate), NOT on deploy/startup, so between a deploy and that action
every per-user profile.sqlite sat below v025 while new code named both columns.
(T5083/T5085 + T8190/T5087 later closed this window with a JIT seam that migrates a
profile on first access -- the T5970 column guards below are now belt-and-braces, not
the only defense.) Two sites 500 with `sqlite3.OperationalError: no such column` on
such a DB:

  1. downloads.publish_to_my_reels  -- SELECT id, filename, slowmo_section_start,
     slowmo_section_end ... (publish gesture on an existing reel)
  2. overlay._finalize_overlay_export -- INSERT INTO final_videos (..., slowmo_section_start,
     slowmo_section_end) ... (EVERY export's finalize -> blocks all exports in the window)

These tests build a REAL on-disk profile DB at the pre-v025 schema WITH ROWS (memory
reference_migration_runner_rowfactory: schema-only assertions miss row-time crashes) and
drive the SHIPPED functions end-to-end (external side effects monkeypatched). Reverting
either source guard turns the corresponding *_guarded_* test red with the OperationalError,
so this is genuine red-first evidence for both call sites -- the INSERT path gets its own
proof because it is the one that blocks all exports. The *_hard_..._raises tests pin the
raw pre-guard SQL failure so a future refactor can't silently reopen the hole.

T5410 note: site (1) above no longer applies. Publish stopped reading
slowmo_section_start/_end entirely (T5410 reversed T5280 -- poster capture moved
to export, so publish has nothing left to reconstruct a slow-mo section for) and
its SELECT was simplified to `id, filename` with no column-guard needed. The
publish-side guard tests below were removed; `test_publish_completes_on_below_v025`
keeps minimal coverage that publish still succeeds on a below-v025 DB. Site (2)
(export finalize) is unchanged by T5410 and keeps its full coverage.
"""

import asyncio
import shutil
import sqlite3
import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import USER_DATA_BASE, get_database_path
from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id

TEST_PROFILE_ID = "testdefault"


def _make_below_v025_db(user_id: str) -> Path:
    """Build a real profile.sqlite at head, then DROP the v025 slowmo columns and set
    PRAGMA user_version=24 so it mirrors a profile that predates the v025 migration.
    Returns the db path; context is left set to (user_id, TEST_PROFILE_ID)."""
    from app.database import ensure_database

    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    ensure_database()  # head schema on disk

    db_path = get_database_path()
    conn = sqlite3.connect(str(db_path))
    conn.execute("ALTER TABLE final_videos DROP COLUMN slowmo_section_start")
    conn.execute("ALTER TABLE final_videos DROP COLUMN slowmo_section_end")
    conn.execute("PRAGMA user_version = 24")
    conn.commit()
    conn.close()
    return db_path


def _cleanup(user_id: str) -> None:
    path = USER_DATA_BASE / user_id
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)


@pytest.fixture
def below_v025_user():
    user_id = f"test_t6030_{uuid.uuid4().hex[:8]}"
    _make_below_v025_db(user_id)
    yield user_id
    _cleanup(user_id)


def _columns(db_path: Path, table: str) -> set:
    conn = sqlite3.connect(str(db_path))
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    conn.close()
    return cols


# --------------------------------------------------------------------------------------
# Sanity: the crafted DB really is below-v025 (has rows-capable tables, lacks the columns)
# --------------------------------------------------------------------------------------

def test_crafted_db_is_below_v025(below_v025_user):
    cols = _columns(get_database_path(), "final_videos")
    assert "slowmo_section_start" not in cols
    assert "slowmo_section_end" not in cols
    # Everything else stays at head -- this is a v025-specific below-head DB.
    assert "poster_filename" in cols


# --------------------------------------------------------------------------------------
# SELECT path -- downloads.publish_to_my_reels
# --------------------------------------------------------------------------------------

def _seed_published_reel(user_id: str) -> int:
    """A project with a published final_video (below-v025 row -> no slowmo columns)."""
    from app.database import get_db_connection

    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', '9:16')")
        project_id = cur.lastrowid
        cur.execute(
            "INSERT INTO final_videos (project_id, filename, version, name, published_at) "
            "VALUES (?, 'final.mp4', 1, 'Reel', CURRENT_TIMESTAMP)",
            (project_id,),
        )
        conn.commit()
    return project_id


def test_publish_completes_on_below_v025(below_v025_user, monkeypatch):
    # T5410: publish's SELECT no longer names the slowmo columns at all (it never
    # reconstructs a section -- poster capture moved to export), so there is
    # nothing left to guard here; this just confirms publish still succeeds on
    # a below-v025 DB.
    project_id = _seed_published_reel(below_v025_user)

    import app.routers.downloads as downloads

    monkeypatch.setattr(downloads, "file_exists_in_r2", lambda *a, **k: False)
    monkeypatch.setattr(downloads, "archive_project", lambda *a, **k: False)

    set_current_user_id(below_v025_user)
    set_current_profile_id(TEST_PROFILE_ID)
    result = asyncio.run(downloads.publish_to_my_reels(project_id, _durable=None))

    assert result["success"] is True
    assert result["final_video_id"] is not None

    # published_at was actually committed.
    from app.database import get_db_connection

    with get_db_connection() as conn:
        row = conn.cursor().execute(
            "SELECT published_at FROM final_videos WHERE project_id = ?", (project_id,)
        ).fetchone()
    assert row["published_at"] is not None


# --------------------------------------------------------------------------------------
# INSERT / export-finalize path -- overlay._finalize_overlay_export
# (its own explicit evidence: this is the site that blocks ALL exports in the window)
# --------------------------------------------------------------------------------------

def _seed_project(user_id: str) -> int:
    from app.database import get_db_connection

    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', '9:16')")
        project_id = cur.lastrowid
        conn.commit()
    return project_id


def test_export_finalize_hard_insert_raises_on_below_v025(below_v025_user):
    # RED pin: the pre-guard INSERT naming both columns 500s on the below-v025 DB.
    _seed_project(below_v025_user)
    from app.database import get_db_connection

    with get_db_connection() as conn, pytest.raises(
        sqlite3.OperationalError, match="has no column named"
    ):
        conn.cursor().execute(
            "INSERT INTO final_videos (filename, slowmo_section_start, slowmo_section_end) "
            "VALUES ('x.mp4', 1.0, 2.0)"
        )


def test_export_finalize_guarded_completes_on_below_v025(below_v025_user, monkeypatch):
    # GREEN: the SHIPPED finalize path materializes a final_video on the below-v025 DB --
    # no export is blocked. Reverting the overlay.py guard turns this red with the INSERT's
    # `no such column`.
    import app.analytics as analytics

    monkeypatch.setattr(analytics, "record_milestone", lambda *a, **k: None)

    project_id = _seed_project(below_v025_user)

    from app.routers.export.overlay import _finalize_overlay_export

    set_current_user_id(below_v025_user)
    set_current_profile_id(TEST_PROFILE_ID)
    final_video_id, _slowmo_section, _duration, _poster_marker_time = _finalize_overlay_export(
        project_id=project_id,
        output_filename="rendered.mp4",
        export_id="job-t6030",
        user_id=below_v025_user,
    )

    assert isinstance(final_video_id, int)

    from app.database import get_db_connection

    with get_db_connection() as conn:
        row = conn.cursor().execute(
            "SELECT id, filename FROM final_videos WHERE id = ?", (final_video_id,)
        ).fetchone()
    assert row is not None
    assert row["filename"] == "rendered.mp4"


# --------------------------------------------------------------------------------------
# At-head: the guard is transparent -- real frozen values are read and written.
# --------------------------------------------------------------------------------------

@pytest.fixture
def at_head_user():
    user_id = f"test_t6030h_{uuid.uuid4().hex[:8]}"
    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    from app.database import ensure_database

    ensure_database()  # full head schema, slowmo columns present
    yield user_id
    _cleanup(user_id)


def test_export_finalize_at_head_persists_slowmo(at_head_user, monkeypatch):
    import app.analytics as analytics

    monkeypatch.setattr(analytics, "record_milestone", lambda *a, **k: None)
    # Freeze a deterministic section so we can assert it lands in the real columns.
    import app.routers.export.overlay as overlay

    monkeypatch.setattr(overlay, "first_slowmo_section", lambda segs: (1.5, 3.5))
    monkeypatch.setattr(overlay, "load_project_clip_segments", lambda pid: [])

    project_id = _seed_project(at_head_user)
    final_video_id, _slowmo_section, _duration, _poster_marker_time = overlay._finalize_overlay_export(
        project_id=project_id,
        output_filename="rendered.mp4",
        export_id="job-head",
        user_id=at_head_user,
    )

    from app.database import get_db_connection

    with get_db_connection() as conn:
        row = conn.cursor().execute(
            "SELECT slowmo_section_start, slowmo_section_end FROM final_videos WHERE id = ?",
            (final_video_id,),
        ).fetchone()
    assert row["slowmo_section_start"] == 1.5
    assert row["slowmo_section_end"] == 3.5


# --------------------------------------------------------------------------------------
# Perf: the guard is ONE probe per request path, never one per row (query_counter).
# --------------------------------------------------------------------------------------

def _seed_working_clips(user_id: str, project_id: int, n: int) -> None:
    from app.database import get_db_connection

    set_current_user_id(user_id)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cur = conn.cursor()
        for i in range(n):
            cur.execute(
                "INSERT INTO working_clips (project_id, sort_order, version) VALUES (?, ?, 1)",
                (project_id, i),
            )
        conn.commit()


def _final_videos_probes(query_counter) -> int:
    return sum("table_info(final_videos)" in s for s in query_counter.statements)


def test_finalize_guard_is_one_probe_not_per_row(below_v025_user, monkeypatch, query_counter):
    # The column_exists probe must run ONCE per finalize regardless of how many working
    # clips the project has -- a PRAGMA per row would be a real regression.
    import app.analytics as analytics

    monkeypatch.setattr(analytics, "record_milestone", lambda *a, **k: None)

    project_id = _seed_project(below_v025_user)
    _seed_working_clips(below_v025_user, project_id, 40)

    from app.routers.export.overlay import _finalize_overlay_export

    before = _final_videos_probes(query_counter)
    _finalize_overlay_export(
        project_id=project_id,
        output_filename="rendered.mp4",
        export_id="job-perf",
        user_id=below_v025_user,
    )
    assert _final_videos_probes(query_counter) - before == 1

# test_publish_guard_is_one_probe removed (T5410): publish no longer runs a
# column_exists probe on final_videos at all (its SELECT was simplified to
# `id, filename` -- see test_publish_completes_on_below_v025 above), so there
# is no probe count left to assert here.
