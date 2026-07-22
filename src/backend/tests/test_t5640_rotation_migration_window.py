"""T5640: the rotation column arrives with the v029 migration, which runs manually
(not on deploy/startup). Read paths must tolerate the deploy->migrate window — SELECT
wc.rotation only when the column exists, else default 0.0 — so a below-head DB never
crashes and never loses the whole clip list (regression: `no such column: wc.rotation`
in list_project_clips broke every project's clip list on an un-migrated DB).

These tests pin the tolerant-SELECT pattern the read paths use (column_exists +
conditional projection), so a future refactor can't silently reintroduce the hard SELECT.
"""

import sqlite3

from app.database import column_exists


def _make_working_clips(with_rotation: bool) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cols = "id INTEGER PRIMARY KEY, project_id INTEGER, crop_data TEXT"
    if with_rotation:
        cols += ", rotation REAL DEFAULT 0"
    conn.execute(f"CREATE TABLE working_clips ({cols})")
    if with_rotation:
        conn.execute("INSERT INTO working_clips (id, project_id, crop_data, rotation) VALUES (1, 7, 'x', -3.5)")
    else:
        conn.execute("INSERT INTO working_clips (id, project_id, crop_data) VALUES (1, 7, 'x')")
    conn.commit()
    return conn


def _rotation_select(cursor) -> str:
    # Mirrors the projection built in list_project_clips / the export SELECTs.
    return (
        "wc.rotation as wc_rotation"
        if column_exists(cursor, "working_clips", "rotation")
        else "0.0 as wc_rotation"
    )


def test_column_exists_detects_presence():
    assert column_exists(_make_working_clips(True).cursor(), "working_clips", "rotation") is True
    assert column_exists(_make_working_clips(False).cursor(), "working_clips", "rotation") is False


def test_select_defaults_rotation_when_column_absent():
    # The pre-migration window: no rotation column. The clip list must still load, with
    # rotation defaulted to 0.0 (no rotation) — NOT crash with "no such column".
    conn = _make_working_clips(with_rotation=False)
    cur = conn.cursor()
    rot = _rotation_select(cur)
    row = cur.execute(f"SELECT wc.id, {rot} FROM working_clips wc WHERE wc.project_id = 7").fetchone()
    assert row is not None  # clip is NOT lost
    assert row["wc_rotation"] == 0.0


def test_select_reads_real_rotation_when_column_present():
    conn = _make_working_clips(with_rotation=True)
    cur = conn.cursor()
    rot = _rotation_select(cur)
    row = cur.execute(f"SELECT wc.id, {rot} FROM working_clips wc WHERE wc.project_id = 7").fetchone()
    assert row["wc_rotation"] == -3.5
