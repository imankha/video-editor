"""
T6630 round 4 -- v042 profile_db migration: text_overlays flat blocks -> regions
containing elements.

Exercises the row-reading path WITH DATA under the migration runner's TUPLE row
factory (migrations/__init__.py connects with plain sqlite3.connect, no
sqlite3.Row) -- mirrors the v017/v027 landmine every prior profile_db migration
test guards against.
"""

import sqlite3

from app.migrations.profile_db.v042_text_overlays_regions import (
    V042TextOverlaysRegions,
)
from app.utils.encoding import decode_data, encode_data


def _make_pre_v042_db(tmp_path):
    """working_videos WITH text_overlays in the OLD flat-block shape, tuple row
    factory -- mirrors exactly how migrations/__init__.py opens the connection."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory override -> tuples
    conn.execute("""
        CREATE TABLE working_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            text_overlays BLOB
        )
    """)
    conn.commit()
    return conn


def _old_block(block_id, text="GOAL", start=0.0, end=2.0, enabled=True):
    return {
        "id": block_id,
        "spec": {"text": text, "font": "anton", "size": 0.06, "color": "#FFFFFF",
                  "align": "center", "position": {"x": 0.5, "y": 0.4}, "maxWidth": 0.8,
                  "shadow": {"blur": 0, "color": "#000000", "opacity": 0},
                  "stroke": {"width": 0, "color": "#000000"}, "animation": "none"},
        "startTime": start,
        "endTime": end,
        "enabled": enabled,
    }


def test_noop_on_missing_working_videos_table(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V042TextOverlaysRegions().up(conn)  # must not raise


def test_noop_on_missing_text_overlays_column(tmp_path):
    """Pre-T5225 DB: working_videos exists but has no text_overlays column at
    all -- must not raise (mirrors every other read/write site's assumption)."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))
    conn.execute("""
        CREATE TABLE working_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.commit()
    V042TextOverlaysRegions().up(conn)  # must not raise


def test_converts_each_standalone_block_to_its_own_region_with_one_element(tmp_path):
    """The core transform: N flat blocks -> N regions, each with exactly one
    element. No grouping/guessing across blocks."""
    conn = _make_pre_v042_db(tmp_path)
    old = [_old_block("b1", text="GOAL", start=0.0, end=2.0),
           _old_block("b2", text="ASSIST", start=5.0, end=7.0, enabled=False)]
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, text_overlays) "
        "VALUES (1, 100, 'test.mp4', 1, ?)",
        (encode_data(old),),
    )
    conn.commit()

    V042TextOverlaysRegions().up(conn)

    row = conn.execute("SELECT text_overlays FROM working_videos WHERE id = 1").fetchone()
    regions = decode_data(row[0])  # positional index -- tuple row factory
    assert len(regions) == 2

    r1 = next(r for r in regions if r["id"] == "b1")
    assert r1["startTime"] == 0.0 and r1["endTime"] == 2.0
    assert len(r1["elements"]) == 1
    assert r1["elements"][0]["id"] == "b1_el0"
    assert r1["elements"][0]["spec"]["text"] == "GOAL"
    assert r1["elements"][0]["enabled"] is True

    r2 = next(r for r in regions if r["id"] == "b2")
    assert r2["elements"][0]["enabled"] is False  # carried over verbatim


def test_region_keeps_the_old_blocks_id(tmp_path):
    """The region's id equals the old standalone block's id (any stray
    reference to that id -- e.g. an in-flight action queued before reload --
    keeps pointing at the same timeline entity)."""
    conn = _make_pre_v042_db(tmp_path)
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, text_overlays) "
        "VALUES (1, 100, 'test.mp4', 1, ?)",
        (encode_data([_old_block("txt_abc123")]),),
    )
    conn.commit()

    V042TextOverlaysRegions().up(conn)

    row = conn.execute("SELECT text_overlays FROM working_videos WHERE id = 1").fetchone()
    regions = decode_data(row[0])
    assert regions[0]["id"] == "txt_abc123"


def test_idempotent_leaves_already_migrated_shape_untouched(tmp_path):
    """A row already in the new region/elements shape (re-run, or a fresh
    export written post-migration) is left byte-identical."""
    conn = _make_pre_v042_db(tmp_path)
    already_new = [{"id": "r1", "startTime": 0.0, "endTime": 2.0,
                     "elements": [{"id": "r1_el0", "spec": {"text": "X"}, "enabled": True},
                                  {"id": "r1_el1", "spec": {"text": "Y"}, "enabled": True}]}]
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, text_overlays) "
        "VALUES (1, 100, 'test.mp4', 1, ?)",
        (encode_data(already_new),),
    )
    conn.commit()

    V042TextOverlaysRegions().up(conn)

    row = conn.execute("SELECT text_overlays FROM working_videos WHERE id = 1").fetchone()
    regions = decode_data(row[0])
    assert regions == already_new  # untouched, including the 2-element region


def test_running_twice_is_a_noop_the_second_time(tmp_path):
    conn = _make_pre_v042_db(tmp_path)
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, text_overlays) "
        "VALUES (1, 100, 'test.mp4', 1, ?)",
        (encode_data([_old_block("b1")]),),
    )
    conn.commit()

    V042TextOverlaysRegions().up(conn)
    row_after_first = conn.execute("SELECT text_overlays FROM working_videos WHERE id = 1").fetchone()
    first_regions = decode_data(row_after_first[0])

    V042TextOverlaysRegions().up(conn)  # must not raise, must not re-wrap
    row_after_second = conn.execute("SELECT text_overlays FROM working_videos WHERE id = 1").fetchone()
    second_regions = decode_data(row_after_second[0])

    assert second_regions == first_regions
    assert len(second_regions[0]["elements"]) == 1  # not double-wrapped


def test_skips_undecodable_blob_without_aborting_other_rows(tmp_path):
    """A row whose text_overlays won't decode is logged + skipped -- must NOT
    abort the migration for other rows (mirrors v027's best-effort contract)."""
    conn = _make_pre_v042_db(tmp_path)
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, text_overlays) "
        "VALUES (1, 100, 'corrupt.mp4', 1, ?)",
        (b"not-valid-msgpack-\xff\xfe",),
    )
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, text_overlays) "
        "VALUES (2, 100, 'good.mp4', 1, ?)",
        (encode_data([_old_block("b1")]),),
    )
    conn.commit()

    V042TextOverlaysRegions().up(conn)  # must not raise

    good_row = conn.execute("SELECT text_overlays FROM working_videos WHERE id = 2").fetchone()
    # Corrupt row is left as-is (still undecodable), good row migrated.
    assert decode_data(good_row[0])[0]["elements"][0]["spec"]["text"] == "GOAL"


def test_empty_and_null_text_overlays_are_left_alone(tmp_path):
    conn = _make_pre_v042_db(tmp_path)
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, text_overlays) "
        "VALUES (1, 100, 'empty.mp4', 1, ?)",
        (encode_data([]),),
    )
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, text_overlays) "
        "VALUES (2, 100, 'null.mp4', 1, NULL)",
    )
    conn.commit()

    V042TextOverlaysRegions().up(conn)  # must not raise

    row1 = conn.execute("SELECT text_overlays FROM working_videos WHERE id = 1").fetchone()
    row2 = conn.execute("SELECT text_overlays FROM working_videos WHERE id = 2").fetchone()
    assert decode_data(row1[0]) == []
    assert row2[0] is None
