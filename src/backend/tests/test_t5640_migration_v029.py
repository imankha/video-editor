"""
T5640 — v029 profile_db migration: add working_clips.rotation (REAL DEFAULT 0).

Pure additive column (no backfill needed — the DEFAULT 0 IS the correct value
for every existing clip, since rotation=0 is byte-identical to today). Exercised
under the migration runner's TUPLE row factory (migrations/__init__.py connects
with plain sqlite3.connect, no sqlite3.Row) so the PRAGMA positional read (r[1])
is the only column probe.
"""

import sqlite3

from app.migrations.profile_db.v029_working_clips_rotation import V029WorkingClipsRotation


def _make_pre_v029_db(tmp_path):
    """working_clips WITHOUT the rotation column, tuple row factory."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory -> tuples
    conn.execute("""
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            crop_data BLOB,
            width INTEGER,
            height INTEGER,
            fps REAL
        )
    """)
    conn.commit()
    return conn


def test_adds_rotation_column_when_missing(tmp_path):
    conn = _make_pre_v029_db(tmp_path)
    cols_before = {row[1] for row in conn.execute("PRAGMA table_info(working_clips)").fetchall()}
    assert "rotation" not in cols_before

    V029WorkingClipsRotation().up(conn)

    cols_after = {row[1] for row in conn.execute("PRAGMA table_info(working_clips)").fetchall()}
    assert "rotation" in cols_after


def test_existing_rows_default_to_zero(tmp_path):
    conn = _make_pre_v029_db(tmp_path)
    conn.execute("INSERT INTO working_clips (project_id) VALUES (1)")
    conn.commit()

    V029WorkingClipsRotation().up(conn)

    val = conn.execute("SELECT rotation FROM working_clips WHERE project_id = 1").fetchone()[0]
    assert val == 0


def test_idempotent_when_column_already_present(tmp_path):
    conn = _make_pre_v029_db(tmp_path)
    V029WorkingClipsRotation().up(conn)  # adds
    V029WorkingClipsRotation().up(conn)  # must not raise / not duplicate

    cols = [row[1] for row in conn.execute("PRAGMA table_info(working_clips)").fetchall()]
    assert cols.count("rotation") == 1


def test_noop_on_missing_working_clips_table(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V029WorkingClipsRotation().up(conn)  # must not raise
