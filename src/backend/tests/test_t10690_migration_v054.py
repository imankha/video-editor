"""
T10690 -- v054 profile_db migration: make raw_clips.rating nullable.

`raw_clips.rating` is `INTEGER NOT NULL`; this migration widens the domain to
also allow NULL ("no rating on record" -- see docs/plans/tasks/T10690-design.md
§ 0). SQLite cannot ALTER COLUMN DROP NOT NULL, so this is a full 12-step
rebuild-and-copy -- the FIRST such rebuild in profile_db/ (every earlier
migration there is ADD/DROP COLUMN only). It must survive three FK-cascade
child tables (`working_clips`, `modal_tasks`, `clip_teammates`, all
`ON DELETE CASCADE` -> `raw_clips(id)`), replay the 3 indexes destroyed by
`DROP TABLE`, and never let `sqlite_sequence` regress (a reused raw_clip id
would silently re-point a published reel's frozen `final_videos.source_clip_id`
at a different play -- T3630).

This migration file does not exist yet (next free slot after v053 is v054,
per the design doc's migration-head audit) -- this test is written test-first
(Stage 3) and is expected to FAIL with an import error until
`app/migrations/profile_db/v054_raw_clips_rating_nullable.py` is created.

Precedent: test_t4330_migration_v044.py (raw sqlite3.connect, tuple row
factory, `_make_pre_vNNN_db(tmp_path)` builder, no ORM).
"""

import sqlite3

from app.migrations.profile_db.v054_raw_clips_rating_nullable import (
    V054RawClipsRatingNullable,
)
from app.profile_context import set_current_profile_id
from app.user_context import set_current_user_id


def _make_pre_v054_db(tmp_path):
    """v053-shaped schema: raw_clips (rating INTEGER NOT NULL) + games (FK
    target) + working_clips + clip_teammates (both cascade children), plus
    the 3 raw_clips indexes. Verbatim copy of database.py's current DDL for
    these tables (database.py:1179-1213, :1237-1258, :1689-1697, :1491-1501)
    -- tuple row factory (no row_factory set), matching the real migration
    seam's plain `sqlite3.connect`.
    """
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory -> tuples

    conn.execute("""
        CREATE TABLE games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            video_filename TEXT,
            blake3_hash TEXT
        )
    """)

    conn.execute("""
        CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            rating INTEGER NOT NULL,
            tags BLOB,
            name TEXT,
            notes TEXT,
            start_time REAL,
            end_time REAL,
            game_id INTEGER,
            auto_project_id INTEGER,
            default_highlight_regions BLOB,
            video_sequence INTEGER,
            tagged_teammates BLOB DEFAULT NULL,
            my_athlete INTEGER DEFAULT 1,
            shared_by TEXT DEFAULT NULL,
            boundaries_version INTEGER DEFAULT 1,
            boundaries_updated_at TIMESTAMP,
            reel_source_start_time REAL,
            reel_source_end_time REAL,
            source TEXT NOT NULL DEFAULT 'game',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
            FOREIGN KEY (auto_project_id) REFERENCES projects(id) ON DELETE SET NULL
        )
    """)

    conn.execute("""
        CREATE TABLE projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            aspect_ratio TEXT NOT NULL
        )
    """)

    conn.execute("""
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            raw_clip_id INTEGER,
            uploaded_filename TEXT,
            exported_at TEXT DEFAULT NULL,
            sort_order INTEGER DEFAULT 0,
            version INTEGER NOT NULL DEFAULT 1,
            crop_data BLOB,
            timing_data BLOB,
            segments_data BLOB,
            raw_clip_version INTEGER,
            width INTEGER,
            height INTEGER,
            fps REAL,
            rotation REAL DEFAULT 0,
            framing_version INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id) ON DELETE CASCADE
        )
    """)

    conn.execute("""
        CREATE TABLE clip_teammates (
            clip_id INTEGER NOT NULL REFERENCES raw_clips(id) ON DELETE CASCADE,
            tag_name TEXT NOT NULL,
            UNIQUE(clip_id, tag_name)
        )
    """)
    conn.execute("""
        CREATE INDEX idx_clip_teammates_tag ON clip_teammates(tag_name)
    """)

    conn.execute("""
        CREATE TABLE modal_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_type TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            params TEXT NOT NULL,
            result TEXT,
            error TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            raw_clip_id INTEGER,
            project_id INTEGER,
            game_id INTEGER,
            retry_count INTEGER DEFAULT 0,
            FOREIGN KEY (raw_clip_id) REFERENCES raw_clips(id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )
    """)

    conn.execute("""
        CREATE INDEX idx_raw_clips_game_id ON raw_clips(game_id)
    """)
    conn.execute("""
        CREATE INDEX idx_raw_clips_rating ON raw_clips(rating)
    """)
    conn.execute("""
        CREATE UNIQUE INDEX idx_raw_clips_game_end_time_seq
        ON raw_clips(game_id, end_time, video_sequence)
    """)

    conn.commit()
    return conn


def _seed_rated_clips_with_children(conn):
    """Insert a game + N rated raw_clips, each with a working_clips child, and
    a clip_teammates + modal_tasks child for the first clip. Returns the list
    of inserted raw_clip ids."""
    conn.execute("INSERT INTO games (name, blake3_hash) VALUES ('G', 'h')")
    game_id = conn.execute("SELECT id FROM games").fetchone()[0]
    conn.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('P', '9:16')")
    project_id = conn.execute("SELECT id FROM projects").fetchone()[0]

    clip_ids = []
    for i, rating in enumerate([5, 4, 3], start=1):
        conn.execute(
            "INSERT INTO raw_clips (filename, rating, game_id, end_time, video_sequence) "
            "VALUES (?, ?, ?, ?, ?)",
            (f"clip{i}.mp4", rating, game_id, float(i * 10), i),
        )
        clip_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        clip_ids.append(clip_id)
        conn.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id) VALUES (?, ?)",
            (project_id, clip_id),
        )

    # A clip_teammates child row for the first clip only.
    conn.execute(
        "INSERT INTO clip_teammates (clip_id, tag_name) VALUES (?, ?)",
        (clip_ids[0], "Alex"),
    )

    # A modal_tasks child row for the first clip only -- the third of the
    # three cascade children the migration must protect (working_clips,
    # clip_teammates above, modal_tasks here).
    conn.execute(
        "INSERT INTO modal_tasks (task_type, status, params, raw_clip_id) "
        "VALUES ('upscale', 'pending', '{}', ?)",
        (clip_ids[0],),
    )

    conn.commit()
    return clip_ids


def _rating_col_info(conn):
    for row in conn.execute("PRAGMA table_info(raw_clips)").fetchall():
        if row[1] == "rating":
            return row  # (cid, name, type, notnull, dflt_value, pk)
    raise AssertionError("rating column not found")


def test_rating_column_accepts_null_after_migration(tmp_path):
    conn = _make_pre_v054_db(tmp_path)
    _seed_rated_clips_with_children(conn)

    assert _rating_col_info(conn)[3] == 1  # NOT NULL before

    V054RawClipsRatingNullable().up(conn)

    assert _rating_col_info(conn)[3] == 0  # nullable after
    # And actually accepts a NULL insert (not just the pragma flag).
    conn.execute(
        "INSERT INTO raw_clips (filename, rating) VALUES ('unrated.mp4', NULL)"
    )
    conn.commit()
    row = conn.execute(
        "SELECT rating FROM raw_clips WHERE filename = 'unrated.mp4'"
    ).fetchone()
    assert row[0] is None


def test_every_raw_clip_and_child_row_survives(tmp_path):
    """FK cascade trap: a naive DROP TABLE under foreign_keys=ON would
    cascade-delete every working_clips/clip_teammates/modal_tasks row
    referencing raw_clips. Assert nothing is lost across all three."""
    conn = _make_pre_v054_db(tmp_path)
    clip_ids = _seed_rated_clips_with_children(conn)

    raw_count_before = conn.execute("SELECT COUNT(*) FROM raw_clips").fetchone()[0]
    working_count_before = conn.execute("SELECT COUNT(*) FROM working_clips").fetchone()[0]
    teammate_count_before = conn.execute("SELECT COUNT(*) FROM clip_teammates").fetchone()[0]
    modal_task_count_before = conn.execute("SELECT COUNT(*) FROM modal_tasks").fetchone()[0]
    ratings_before = sorted(
        r[0] for r in conn.execute("SELECT rating FROM raw_clips").fetchall()
    )
    assert raw_count_before == len(clip_ids) == 3
    assert working_count_before == 3
    assert teammate_count_before == 1
    assert modal_task_count_before == 1

    V054RawClipsRatingNullable().up(conn)

    assert conn.execute("SELECT COUNT(*) FROM raw_clips").fetchone()[0] == raw_count_before
    assert conn.execute("SELECT COUNT(*) FROM working_clips").fetchone()[0] == working_count_before
    assert conn.execute("SELECT COUNT(*) FROM clip_teammates").fetchone()[0] == teammate_count_before
    assert conn.execute("SELECT COUNT(*) FROM modal_tasks").fetchone()[0] == modal_task_count_before
    ratings_after = sorted(
        r[0] for r in conn.execute("SELECT rating FROM raw_clips").fetchall()
    )
    assert ratings_after == ratings_before  # values untouched, no backfill

    # Every working_clips/modal_tasks row still points at a live raw_clip.
    orphans = conn.execute("""
        SELECT wc.id FROM working_clips wc
        LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
        WHERE wc.raw_clip_id IS NOT NULL AND rc.id IS NULL
    """).fetchall()
    assert orphans == []
    orphan_tasks = conn.execute("""
        SELECT mt.id FROM modal_tasks mt
        LEFT JOIN raw_clips rc ON mt.raw_clip_id = rc.id
        WHERE mt.raw_clip_id IS NOT NULL AND rc.id IS NULL
    """).fetchall()
    assert orphan_tasks == []


def test_all_three_indexes_survive(tmp_path):
    conn = _make_pre_v054_db(tmp_path)
    _seed_rated_clips_with_children(conn)

    V054RawClipsRatingNullable().up(conn)

    index_names = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='raw_clips'"
        ).fetchall()
    }
    assert "idx_raw_clips_game_id" in index_names
    assert "idx_raw_clips_rating" in index_names
    assert "idx_raw_clips_game_end_time_seq" in index_names

    # The unique index must still enforce uniqueness (replayed verbatim, not
    # just present by name).
    row = conn.execute(
        "SELECT game_id, end_time, video_sequence FROM raw_clips LIMIT 1"
    ).fetchone()
    import pytest as _pytest
    with _pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO raw_clips (filename, rating, game_id, end_time, video_sequence) "
            "VALUES ('dup.mp4', 5, ?, ?, ?)",
            row,
        )


def test_sqlite_sequence_does_not_regress(tmp_path):
    """Delete-then-reinsert scenario: after deleting the highest-id raw_clip
    and inserting a new one pre-migration, the AUTOINCREMENT sequence must
    not go backwards across the rebuild (T3630 id-reuse hazard)."""
    conn = _make_pre_v054_db(tmp_path)
    clip_ids = _seed_rated_clips_with_children(conn)
    max_id = max(clip_ids)

    # Delete the highest-id clip and its children so a naive rebuild without
    # seq-restore would let AUTOINCREMENT reuse that id.
    conn.execute("DELETE FROM working_clips WHERE raw_clip_id = ?", (max_id,))
    conn.execute("DELETE FROM clip_teammates WHERE clip_id = ?", (max_id,))
    conn.execute("DELETE FROM raw_clips WHERE id = ?", (max_id,))
    conn.commit()

    seq_before = conn.execute(
        "SELECT seq FROM sqlite_sequence WHERE name='raw_clips'"
    ).fetchone()
    assert seq_before is not None
    old_seq = seq_before[0]
    assert old_seq >= max_id

    V054RawClipsRatingNullable().up(conn)

    seq_after = conn.execute(
        "SELECT seq FROM sqlite_sequence WHERE name='raw_clips'"
    ).fetchone()
    assert seq_after is not None
    assert seq_after[0] >= old_seq  # never regresses

    # A fresh insert must not reuse the deleted id.
    conn.execute("INSERT INTO raw_clips (filename, rating) VALUES ('new.mp4', 5)")
    conn.commit()
    new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    assert new_id > max_id


def test_rerunning_up_is_a_noop(tmp_path):
    conn = _make_pre_v054_db(tmp_path)
    _seed_rated_clips_with_children(conn)

    V054RawClipsRatingNullable().up(conn)
    count_after_first = conn.execute("SELECT COUNT(*) FROM raw_clips").fetchone()[0]

    # Must not raise, and must not duplicate/alter data or indexes.
    V054RawClipsRatingNullable().up(conn)

    assert conn.execute("SELECT COUNT(*) FROM raw_clips").fetchone()[0] == count_after_first
    assert _rating_col_info(conn)[3] == 0
    index_names = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='raw_clips'"
        ).fetchall()
    }
    assert {"idx_raw_clips_game_id", "idx_raw_clips_rating", "idx_raw_clips_game_end_time_seq"} <= index_names


def test_foreign_key_check_clean_after_migration(tmp_path):
    conn = _make_pre_v054_db(tmp_path)
    _seed_rated_clips_with_children(conn)

    V054RawClipsRatingNullable().up(conn)

    conn.execute("PRAGMA foreign_keys=ON")
    violations = conn.execute("PRAGMA foreign_key_check").fetchall()
    assert violations == []


def test_noop_on_missing_raw_clips_table(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V054RawClipsRatingNullable().up(conn)  # must not raise


def test_registered_in_profile_db_migrations():
    """v054 must be appended to MIGRATIONS in app/migrations/profile_db/__init__.py
    -- otherwise the runner never applies it. Deliberately does not assert v054
    is the head (mirrors test_t4330_migration_v044.py's rationale: a later
    migration landing above it must not break this test)."""
    from app.migrations.profile_db import MIGRATIONS

    versions = [m.version for m in MIGRATIONS]
    assert 54 in versions, "v054 must be registered in profile_db MIGRATIONS"


def test_fresh_ensure_database_already_nullable(tmp_path):
    """A brand-new deploy's ensure_database() DDL must declare `rating INTEGER`
    (no NOT NULL) directly (design doc § A.1) -- fresh DBs don't run migrations,
    they get the head shape as-is."""
    import uuid

    from app.database import USER_DATA_BASE, ensure_database, get_database_path

    user_id = f"test_v054_fresh_{uuid.uuid4().hex[:8]}"
    try:
        set_current_user_id(user_id)
        set_current_profile_id("testdefault")
        ensure_database()

        conn = sqlite3.connect(str(get_database_path()))
        col = None
        for row in conn.execute("PRAGMA table_info(raw_clips)").fetchall():
            if row[1] == "rating":
                col = row
        conn.close()
        assert col is not None
        assert col[3] == 0, "raw_clips.rating must be nullable on a fresh DB (database.py DDL)"
    finally:
        path = USER_DATA_BASE / user_id
        if path.exists():
            import shutil

            shutil.rmtree(path, ignore_errors=True)
