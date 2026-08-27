"""
T4330 — v044 profile_db migration: add working_clips.framing_version
(INTEGER NOT NULL DEFAULT 0).

Pure additive column, modeled directly on v029's rotation migration (same
guarded PRAGMA table_info ALTER, tuple row factory under the migration
runner). DEFAULT 0 IS the correct value for every existing clip -- no
backfill needed; the first framing action on an old row omits
expected_version (see actionClient's "omit until first success" rule) and
lands regardless.

This migration file does not exist yet (next free slot after v043 is v044,
per the design doc's migration-head audit) -- this test is written test-first
(Stage 3) and is expected to FAIL with an import error until
`app/migrations/profile_db/v044_working_clips_framing_version.py` is created.
"""

import sqlite3

from app.migrations.profile_db.v044_working_clips_framing_version import (
    V044WorkingClipsFramingVersion,
)
from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id


def _make_pre_v044_db(tmp_path):
    """working_clips WITHOUT the framing_version column, tuple row factory."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory -> tuples
    conn.execute("""
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            crop_data BLOB,
            segments_data BLOB,
            width INTEGER,
            height INTEGER,
            fps REAL,
            rotation REAL DEFAULT 0
        )
    """)
    conn.commit()
    return conn


def test_adds_framing_version_column_when_missing(tmp_path):
    conn = _make_pre_v044_db(tmp_path)
    cols_before = {row[1] for row in conn.execute("PRAGMA table_info(working_clips)").fetchall()}
    assert "framing_version" not in cols_before

    V044WorkingClipsFramingVersion().up(conn)

    cols_after = {row[1] for row in conn.execute("PRAGMA table_info(working_clips)").fetchall()}
    assert "framing_version" in cols_after


def test_existing_rows_default_to_zero(tmp_path):
    conn = _make_pre_v044_db(tmp_path)
    conn.execute("INSERT INTO working_clips (project_id) VALUES (1)")
    conn.commit()

    V044WorkingClipsFramingVersion().up(conn)

    val = conn.execute("SELECT framing_version FROM working_clips WHERE project_id = 1").fetchone()[0]
    assert val == 0


def test_idempotent_when_column_already_present(tmp_path):
    conn = _make_pre_v044_db(tmp_path)
    V044WorkingClipsFramingVersion().up(conn)  # adds
    V044WorkingClipsFramingVersion().up(conn)  # must not raise / not duplicate

    cols = [row[1] for row in conn.execute("PRAGMA table_info(working_clips)").fetchall()]
    assert cols.count("framing_version") == 1


def test_noop_on_missing_working_clips_table(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V044WorkingClipsFramingVersion().up(conn)  # must not raise


def test_registered_in_profile_db_migrations():
    """v044 must be appended to MIGRATIONS in app/migrations/profile_db/__init__.py
    (design doc section 2.7) -- otherwise the runner never applies it and
    test_migrations.py::test_profile_db_track's ordering/no-duplicates
    invariants would also fail once someone else registers a colliding v044.

    Deliberately does NOT assert v044 is the current head: several later
    migrations (v045, v046, v047, ...) have already landed above it, and this
    test does not own the track's head -- that's test_migrations.py's dynamic
    RUNNER.latest_version check. Pinning a hardcoded head number here just
    breaks every time an unrelated later migration lands (this test was
    itself bumped 44->45->46 for that reason -- see git history)."""
    from app.migrations.profile_db import MIGRATIONS

    versions = [m.version for m in MIGRATIONS]
    assert 44 in versions, "v044 must be registered in profile_db MIGRATIONS"


def test_fresh_ensure_database_already_has_the_column(tmp_path):
    """A brand-new deploy's ensure_database() DDL must include framing_version
    directly (design doc section 2.7 step 1) -- fresh DBs don't run migrations,
    they get the DDL as-is. Mirrors the real ensure_database() call pattern used
    by tests/test_t6030_migration_window_structural_guard.py (_build_below_head_db):
    set user/profile context, then call ensure_database() for a genuinely fresh
    per-user DB, and inspect the resulting file on disk."""
    import uuid

    from app.database import USER_DATA_BASE, ensure_database, get_database_path

    user_id = f"test_v044_fresh_{uuid.uuid4().hex[:8]}"
    try:
        set_current_user_id(user_id)
        set_current_profile_id("testdefault")
        ensure_database()

        conn = sqlite3.connect(str(get_database_path()))
        cols = {row[1] for row in conn.execute("PRAGMA table_info(working_clips)").fetchall()}
        conn.close()
        assert "framing_version" in cols
    finally:
        path = USER_DATA_BASE / user_id
        if path.exists():
            import shutil

            shutil.rmtree(path, ignore_errors=True)
