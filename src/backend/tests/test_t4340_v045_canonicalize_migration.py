"""
T4340 (Tester Phase 1, FAILING by design) -- migration v045: rewrite existing
splits-only working_clips.segments_data rows to full-list.

Design: docs/plans/tasks/T4340-design.md Sec 3 Step 4 (module path, per-row
logic, worked example + reindex proof) and Sec 3 Step 6 items 6-9.

The migration module `app.migrations.profile_db.v045_canonicalize_working_clip_segments`
does NOT exist yet -- these tests import it directly and must fail on
ModuleNotFoundError / ImportError until Stage 4 creates the file. That is the
correct failure mode for this phase (not a fixture bug).

Row-factory discipline (v017-class bug guard, design Sec 3 Step 4): `up(conn)`
must read rows POSITIONALLY (tuple, `r[0]`), never `r['col']`. sqlite3's
DEFAULT connection (no `row_factory` set) already yields plain tuples, so
these tests deliberately do NOT set `conn.row_factory = sqlite3.Row` --
mirroring the real migration runner's connection shape for profile_db
(see test_migration_runner.py / test_clip_range_normalization.py precedent).
If the migration's `up()` used `row['col']` it would raise `TypeError: tuple
indices must be integers` here, catching the mistake directly.
"""

import sqlite3

import pytest

from app.utils.encoding import decode_data, encode_data

# This import is the FIRST thing expected to fail (module doesn't exist yet).
from app.migrations.profile_db.v045_canonicalize_working_clip_segments import (
    V045CanonicalizeWorkingClipSegments,
)


def _make_db():
    """Minimal working_clips + raw_clips schema, positional (tuple) rows --
    default sqlite3 connection row_factory, matching the real migration
    runner's connection for profile_db (no sqlite3.Row here on purpose)."""
    conn = sqlite3.connect(":memory:")
    conn.execute("""
        CREATE TABLE raw_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time REAL,
            end_time REAL
        )
    """)
    conn.execute("""
        CREATE TABLE working_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            raw_clip_id INTEGER,
            segments_data BLOB
        )
    """)
    return conn


def _insert_raw_clip(conn, start, end):
    conn.execute("INSERT INTO raw_clips (start_time, end_time) VALUES (?, ?)", (start, end))
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def _insert_working_clip(conn, raw_clip_id, segments_data):
    blob = encode_data(segments_data) if segments_data is not None else None
    conn.execute(
        "INSERT INTO working_clips (project_id, raw_clip_id, segments_data) VALUES (1, ?, ?)",
        (raw_clip_id, blob),
    )
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def _read_segments(conn, clip_id):
    row = conn.execute(
        "SELECT segments_data FROM working_clips WHERE id = ?", (clip_id,)
    ).fetchone()
    blob = row[0]  # tuple row -- positional, matches migration's own discipline
    return decode_data(blob) if blob is not None else None


# ---------------------------------------------------------------------------
# Test 6 -- migration with data: the exact worked example from the design doc
# ---------------------------------------------------------------------------

def test_worked_example_boundaries_and_speeds():
    """Design Sec 3 Step 4 worked example verbatim:
    boundaries=[3.0,7.0], raw_duration=10.0, segmentSpeeds={"0":2.0,"1":1.0,"2":0.5}
    -> boundaries=[0.0,3.0,7.0,10.0], segmentSpeeds unchanged (same physical
    intervals -- QED table in the design doc)."""
    conn = _make_db()
    raw_id = _insert_raw_clip(conn, start=0.0, end=10.0)
    clip_id = _insert_working_clip(conn, raw_id, {
        "boundaries": [3.0, 7.0],
        "segmentSpeeds": {"0": 2.0, "1": 1.0, "2": 0.5},
    })
    conn.commit()

    V045CanonicalizeWorkingClipSegments().up(conn)

    result = _read_segments(conn, clip_id)
    assert result["boundaries"] == [0.0, 3.0, 7.0, 10.0], (
        f"expected full-list [0.0, 3.0, 7.0, 10.0], got {result.get('boundaries')}"
    )
    assert result["segmentSpeeds"] == {"0": 2.0, "1": 1.0, "2": 0.5}, (
        f"segmentSpeeds must be UNCHANGED by canonicalization (already keyed "
        f"over the full-list intervals) -- got {result.get('segmentSpeeds')}"
    )


# ---------------------------------------------------------------------------
# Test 7 -- migration idempotency: second run is a no-op on already-full rows
# ---------------------------------------------------------------------------

def test_idempotent_second_run_is_noop():
    conn = _make_db()
    raw_id = _insert_raw_clip(conn, start=0.0, end=10.0)
    clip_id = _insert_working_clip(conn, raw_id, {
        "boundaries": [3.0, 7.0],
        "segmentSpeeds": {"0": 2.0, "1": 1.0, "2": 0.5},
    })
    conn.commit()

    V045CanonicalizeWorkingClipSegments().up(conn)
    after_first = _read_segments(conn, clip_id)
    assert after_first["boundaries"] == [0.0, 3.0, 7.0, 10.0]

    # Second run: already full-list (boundaries[0] <= 0.01) -> must skip, no change.
    V045CanonicalizeWorkingClipSegments().up(conn)
    after_second = _read_segments(conn, clip_id)
    assert after_second == after_first, (
        f"second run must be a no-op on an already-canonical row; "
        f"before={after_first}, after={after_second}"
    )


# ---------------------------------------------------------------------------
# Test 8 -- migration edge rows: no crash, no fabricated duration
# ---------------------------------------------------------------------------

def test_edge_rows_handled_without_error():
    conn = _make_db()

    # Row with NULL segments_data (never touched framing).
    raw_a = _insert_raw_clip(conn, start=0.0, end=10.0)
    clip_null = _insert_working_clip(conn, raw_a, None)

    # Row with empty dict segments_data.
    raw_b = _insert_raw_clip(conn, start=0.0, end=10.0)
    clip_empty = _insert_working_clip(conn, raw_b, {})

    # Trim-only row -- no 'boundaries' key at all.
    raw_c = _insert_raw_clip(conn, start=0.0, end=10.0)
    clip_trim_only = _insert_working_clip(conn, raw_c, {
        "trimRange": {"start": 1.0, "end": 5.0}
    })

    # Orphan row: raw_clip_id NULL -> no raw_duration derivable via the JOIN.
    clip_orphan = _insert_working_clip(conn, None, {
        "boundaries": [3.0, 7.0],
        "segmentSpeeds": {"0": 1.0},
    })
    conn.commit()

    # Must not raise for any of these rows.
    V045CanonicalizeWorkingClipSegments().up(conn)

    assert _read_segments(conn, clip_null) is None
    assert _read_segments(conn, clip_empty) == {}
    assert _read_segments(conn, clip_trim_only) == {"trimRange": {"start": 1.0, "end": 5.0}}

    # Orphan: no raw_duration -> must SKIP (never guess a duration), splits-only
    # blob stays as-is.
    orphan_result = _read_segments(conn, clip_orphan)
    assert orphan_result["boundaries"] == [3.0, 7.0], (
        f"orphan row (no raw_duration) must be left splits-only, not guessed "
        f"into a full-list -- got {orphan_result.get('boundaries')}"
    )


# ---------------------------------------------------------------------------
# Test 9 -- tuple row-factory discipline (v017-class bug guard)
# ---------------------------------------------------------------------------

def test_runs_under_default_tuple_row_factory_no_dict_access():
    """conn.row_factory is left at sqlite3's default (plain tuples) for this
    whole file -- if `up()` used dict-style `row['col']` access anywhere on the
    SELECT/PRAGMA rows, this would raise `TypeError: tuple indices must be
    integers or slices, not str` inside `up()`, not inside the test. A pass
    here means the migration is disciplined about positional access, matching
    v029/v044/v012 precedent (the migration runner's real connection never
    sets `row_factory = sqlite3.Row`)."""
    conn = _make_db()
    assert conn.row_factory is None, "test setup: connection must use the default tuple row factory"

    raw_id = _insert_raw_clip(conn, start=0.0, end=20.0)
    _insert_working_clip(conn, raw_id, {
        "boundaries": [5.0],
        "segmentSpeeds": {"1": 0.5},
    })
    conn.commit()

    # Must not raise TypeError from dict-style row access.
    V045CanonicalizeWorkingClipSegments().up(conn)


def test_no_working_clips_table_is_noop():
    """Mirrors the v012 'table absent' guard precedent -- a profile_db that
    somehow lacks working_clips (should not happen, but migrations must be
    defensive about table existence per the v029/v044 pattern) must not raise."""
    conn = sqlite3.connect(":memory:")
    V045CanonicalizeWorkingClipSegments().up(conn)
