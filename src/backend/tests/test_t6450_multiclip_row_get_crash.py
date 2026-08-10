"""Regression test for T6450: the multi-clip export's DB-fallback branch (no
uploaded video files -> resolve clips from the project's working_clips rows)
passed a raw sqlite3.Row into resolve_clip_source (export_helpers.py, typed
`clip: dict`, calls .get()) -- crashing every such export with
`AttributeError: 'sqlite3.Row' object has no attribute 'get'`.

Fixed at the fetch boundary in multi_clip.py:
    db_clips = [dict(row) for row in cursor.fetchall()]
mirroring the single-clip path (framing.py), which already converts before
calling the same shared resolver.
"""

import sqlite3

import pytest

from app.services.export_helpers import SourceUnavailable, resolve_clip_source


def _real_sqlite_row():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE t (id INTEGER, game_id INTEGER, game_blake3_hash TEXT, raw_filename TEXT)"
    )
    conn.execute("INSERT INTO t VALUES (7, NULL, NULL, '')")
    row = conn.execute("SELECT * FROM t").fetchone()
    conn.close()
    return row


def test_raw_sqlite_row_crashes_resolve_clip_source():
    """Documents the exact T6450 crash mode: a bare sqlite3.Row has no .get()."""
    row = _real_sqlite_row()
    with pytest.raises(AttributeError, match="get"):
        resolve_clip_source(row)


def test_dict_converted_row_does_not_crash():
    """The fix: dict(row) before calling resolve_clip_source -- reaches the real
    "no source configured" failure (SourceUnavailable), not the AttributeError."""
    row = _real_sqlite_row()
    with pytest.raises(SourceUnavailable):
        resolve_clip_source(dict(row))
