"""
T5600 — v027 profile_db migration: add working_videos.detections_data +
backfill from region detections.

Exercises the row-reading path WITH DATA under the migration runner's TUPLE
row factory (migrations/__init__.py connects with plain sqlite3.connect, no
sqlite3.Row) -- the backfill SELECT must index rows positionally (r[0], r[1]),
mirroring the v017 landmine every prior profile_db migration test guards
against. This is the "SEEDED pre-migration blob that actually has detections"
case called out in the T5600 QA plan -- not just the empty/early-return path.
"""

import sqlite3

from app.migrations.profile_db.v027_working_video_detections_data import (
    V027WorkingVideoDetectionsData,
)
from app.utils.encoding import decode_data, encode_data


def _make_pre_v027_db(tmp_path):
    """working_videos WITHOUT detections_data (pre-migration schema), tuple
    row factory -- mirrors exactly how migrations/__init__.py opens the
    connection."""
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no row_factory override -> tuples
    conn.execute("""
        CREATE TABLE working_videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            highlights_data BLOB
        )
    """)
    conn.commit()
    return conn


def _region(region_id, detections=None, video_width=None, video_height=None, fps=None):
    return {
        "id": region_id,
        "start_time": 0.0,
        "end_time": 2.0,
        "enabled": True,
        "keyframes": [],
        "detections": detections or [],
        "videoWidth": video_width,
        "videoHeight": video_height,
        "fps": fps,
    }


def test_adds_column_when_missing(tmp_path):
    conn = _make_pre_v027_db(tmp_path)
    cols_before = {row[1] for row in conn.execute("PRAGMA table_info(working_videos)").fetchall()}
    assert "detections_data" not in cols_before

    V027WorkingVideoDetectionsData().up(conn)

    cols_after = {row[1] for row in conn.execute("PRAGMA table_info(working_videos)").fetchall()}
    assert "detections_data" in cols_after


def test_idempotent_when_column_already_present(tmp_path):
    conn = _make_pre_v027_db(tmp_path)
    V027WorkingVideoDetectionsData().up(conn)  # first run adds the column
    V027WorkingVideoDetectionsData().up(conn)  # must not raise / not duplicate-add

    cols = [row[1] for row in conn.execute("PRAGMA table_info(working_videos)").fetchall()]
    assert cols.count("detections_data") == 1


def test_backfills_from_seeded_region_detections(tmp_path):
    """A pre-migration working_video with real per-region detections gets a
    hoisted video-level payload -- the SEEDED-with-data path, not empty."""
    conn = _make_pre_v027_db(tmp_path)

    regions = [
        _region(
            "region-1",
            detections=[
                {"timestamp": 1.0, "frame": 30, "boxes": [{"x": 0.1, "y": 0.2}]},
                {"timestamp": 1.5, "frame": 45, "boxes": []},
            ],
            video_width=810,
            video_height=1440,
            fps=30,
        ),
        _region(
            "region-2",
            detections=[
                {"timestamp": 5.0, "frame": 150, "boxes": [{"x": 0.3, "y": 0.4}]},
            ],
        ),
    ]
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, highlights_data) "
        "VALUES (1, 100, 'test.mp4', 1, ?)",
        (encode_data(regions),),
    )
    conn.commit()

    V027WorkingVideoDetectionsData().up(conn)

    row = conn.execute("SELECT detections_data FROM working_videos WHERE id = 1").fetchone()
    assert row[0] is not None  # positional index -- tuple row factory
    payload = decode_data(row[0])

    assert payload["videoWidth"] == 810
    assert payload["videoHeight"] == 1440
    assert payload["fps"] == 30
    timestamps = sorted(d["timestamp"] for d in payload["detections"])
    assert timestamps == [1.0, 1.5, 5.0]


def test_backfill_dedups_by_timestamp_and_frame(tmp_path):
    """Overlapping regions that both embed the same detection entry hoist to
    ONE entry, not two."""
    conn = _make_pre_v027_db(tmp_path)

    shared_detection = {"timestamp": 2.0001, "frame": 60, "boxes": [{"x": 0.5, "y": 0.5}]}
    regions = [
        _region("region-1", detections=[shared_detection], video_width=640, video_height=1136, fps=30),
        _region("region-2", detections=[dict(shared_detection)]),
    ]
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, highlights_data) "
        "VALUES (1, 100, 'test.mp4', 1, ?)",
        (encode_data(regions),),
    )
    conn.commit()

    V027WorkingVideoDetectionsData().up(conn)

    row = conn.execute("SELECT detections_data FROM working_videos WHERE id = 1").fetchone()
    payload = decode_data(row[0])
    assert len(payload["detections"]) == 1


def test_backfill_leaves_null_when_no_region_has_metadata(tmp_path):
    """Detections exist but no region carries videoWidth/videoHeight/fps ->
    can't scale re-sliced detections correctly, so leave NULL rather than
    fabricate metadata (CLAUDE.md: no silent fallbacks)."""
    conn = _make_pre_v027_db(tmp_path)

    regions = [_region("region-1", detections=[{"timestamp": 1.0, "frame": 30, "boxes": []}])]
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, highlights_data) "
        "VALUES (1, 100, 'test.mp4', 1, ?)",
        (encode_data(regions),),
    )
    conn.commit()

    V027WorkingVideoDetectionsData().up(conn)

    row = conn.execute("SELECT detections_data FROM working_videos WHERE id = 1").fetchone()
    assert row[0] is None


def test_backfill_leaves_null_when_no_detections_embedded(tmp_path):
    """Default (no-detection) regions, e.g. from generate_default_highlight_regions,
    have empty detections everywhere -- nothing to hoist, stays NULL."""
    conn = _make_pre_v027_db(tmp_path)

    regions = [_region("region-1", detections=[])]
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, highlights_data) "
        "VALUES (1, 100, 'test.mp4', 1, ?)",
        (encode_data(regions),),
    )
    conn.commit()

    V027WorkingVideoDetectionsData().up(conn)

    row = conn.execute("SELECT detections_data FROM working_videos WHERE id = 1").fetchone()
    assert row[0] is None


def test_backfill_skips_undecodable_blob_without_aborting(tmp_path):
    """A row whose highlights_data won't decode is logged + skipped -- it must
    NOT abort the migration for other rows (mirrors v025's best-effort-per-row
    contract)."""
    conn = _make_pre_v027_db(tmp_path)

    good_regions = [
        _region(
            "region-1",
            detections=[{"timestamp": 1.0, "frame": 30, "boxes": [{"x": 0.1, "y": 0.1}]}],
            video_width=810,
            video_height=1440,
            fps=30,
        )
    ]
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, highlights_data) "
        "VALUES (1, 100, 'corrupt.mp4', 1, ?)",
        (b"not-valid-msgpack-\xff\xfe", ),
    )
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, highlights_data) "
        "VALUES (2, 100, 'good.mp4', 1, ?)",
        (encode_data(good_regions),),
    )
    conn.commit()

    V027WorkingVideoDetectionsData().up(conn)  # must not raise

    corrupt_row = conn.execute("SELECT detections_data FROM working_videos WHERE id = 1").fetchone()
    good_row = conn.execute("SELECT detections_data FROM working_videos WHERE id = 2").fetchone()
    assert corrupt_row[0] is None
    assert good_row[0] is not None
    assert decode_data(good_row[0])["videoWidth"] == 810


def test_backfill_idempotent_never_overwrites_existing_value(tmp_path):
    """A row that already has detections_data (new export, or a prior migration
    run) is never touched again -- only NULL rows are candidates."""
    conn = _make_pre_v027_db(tmp_path)

    conn.execute("ALTER TABLE working_videos ADD COLUMN detections_data BLOB")
    existing_payload = encode_data({"videoWidth": 1, "videoHeight": 1, "fps": 30, "detections": []})
    regions = [
        _region(
            "region-1",
            detections=[{"timestamp": 9.0, "frame": 270, "boxes": [{"x": 0.9, "y": 0.9}]}],
            video_width=9999,
            video_height=9999,
            fps=60,
        )
    ]
    conn.execute(
        "INSERT INTO working_videos (id, project_id, filename, version, highlights_data, detections_data) "
        "VALUES (1, 100, 'test.mp4', 1, ?, ?)",
        (encode_data(regions), existing_payload),
    )
    conn.commit()

    V027WorkingVideoDetectionsData().up(conn)

    row = conn.execute("SELECT detections_data FROM working_videos WHERE id = 1").fetchone()
    assert decode_data(row[0])["videoWidth"] == 1  # unchanged, not re-hoisted from regions


def test_noop_on_missing_working_videos_table(tmp_path):
    db = tmp_path / "profile.sqlite"
    conn = sqlite3.connect(str(db))  # no tables at all
    V027WorkingVideoDetectionsData().up(conn)  # must not raise
