"""Tests for profile_db v014: collapse near-duplicate crop/highlight keyframes."""

import sqlite3
import tempfile
import os

import pytest

from app.utils.encoding import encode_data, decode_data
from app.migrations.profile_db.v014_collapse_duplicate_keyframes import (
    V014CollapseDuplicateKeyframes,
    _collapse,
    CROP_MIN_FRAME_GAP,
    HIGHLIGHT_MIN_TIME_GAP,
)


def _crop_kf(frame, x=0):
    return {"frame": frame, "x": x, "y": 0, "width": 640, "height": 360, "origin": "user"}


def _hl_kf(time):
    return {"time": time, "x": 0.5, "y": 0.5, "radiusX": 0.1, "radiusY": 0.15}


# ---------------------------------------------------------------------------
# _collapse unit cases
# ---------------------------------------------------------------------------

class TestCollapseHelper:
    def test_no_change_when_well_spaced(self):
        kfs = [_crop_kf(0), _crop_kf(50), _crop_kf(100)]
        out, changed = _collapse(kfs, lambda k: k["frame"], CROP_MIN_FRAME_GAP)
        assert changed is False
        assert [k["frame"] for k in out] == [0, 50, 100]

    def test_two_keyframes_never_touched(self):
        kfs = [_crop_kf(0), _crop_kf(3)]  # closer than gap but they are the boundaries
        out, changed = _collapse(kfs, lambda k: k["frame"], CROP_MIN_FRAME_GAP)
        assert changed is False
        assert [k["frame"] for k in out] == [0, 3]

    def test_interior_duplicate_collapses_to_first(self):
        kfs = [_crop_kf(0), _crop_kf(50, x=1), _crop_kf(55, x=2), _crop_kf(100)]
        out, changed = _collapse(kfs, lambda k: k["frame"], CROP_MIN_FRAME_GAP)
        assert changed is True
        assert [k["frame"] for k in out] == [0, 50, 100]
        # earliest of the cluster (and its data) is kept
        assert next(k for k in out if k["frame"] == 50)["x"] == 1

    def test_near_end_duplicate_keeps_boundary(self):
        # 95 sits within 10 frames of the end boundary 100 -> boundary wins
        kfs = [_crop_kf(0), _crop_kf(95), _crop_kf(100)]
        out, changed = _collapse(kfs, lambda k: k["frame"], CROP_MIN_FRAME_GAP)
        assert changed is True
        assert [k["frame"] for k in out] == [0, 100]

    def test_exactly_min_gap_is_kept(self):
        # 95 and 105 are exactly MIN apart -> not a duplicate
        kfs = [_crop_kf(0), _crop_kf(95), _crop_kf(105)]
        out, changed = _collapse(kfs, lambda k: k["frame"], CROP_MIN_FRAME_GAP)
        assert changed is False
        assert [k["frame"] for k in out] == [0, 95, 105]

    def test_unsorted_input_is_sorted(self):
        kfs = [_crop_kf(100), _crop_kf(0), _crop_kf(52), _crop_kf(50)]
        out, changed = _collapse(kfs, lambda k: k["frame"], CROP_MIN_FRAME_GAP)
        assert changed is True
        assert [k["frame"] for k in out] == [0, 50, 100]


# ---------------------------------------------------------------------------
# Migration against a real (temp) profile sqlite
# ---------------------------------------------------------------------------

@pytest.fixture
def conn():
    with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
        db_path = f.name
    c = sqlite3.connect(db_path)
    c.execute("CREATE TABLE working_clips (id INTEGER PRIMARY KEY, crop_data BLOB)")
    c.execute("CREATE TABLE working_videos (id INTEGER PRIMARY KEY, highlights_data BLOB)")
    yield c
    c.close()
    os.unlink(db_path)


def _insert_clip(conn, clip_id, keyframes):
    conn.execute(
        "INSERT INTO working_clips (id, crop_data) VALUES (?, ?)",
        (clip_id, encode_data(keyframes)),
    )


def _get_clip(conn, clip_id):
    row = conn.execute(
        "SELECT crop_data FROM working_clips WHERE id = ?", (clip_id,)
    ).fetchone()
    return decode_data(row[0])


class TestMigrationCrop:
    def test_collapses_duplicate_crop_keyframes(self, conn):
        _insert_clip(conn, 1, [_crop_kf(0), _crop_kf(50), _crop_kf(55), _crop_kf(100)])
        V014CollapseDuplicateKeyframes().up(conn)
        assert [k["frame"] for k in _get_clip(conn, 1)] == [0, 50, 100]

    def test_preserves_end_boundary_when_duplicate_is_near_end(self, conn):
        _insert_clip(conn, 1, [_crop_kf(0), _crop_kf(95), _crop_kf(100)])
        V014CollapseDuplicateKeyframes().up(conn)
        # the permanent end boundary (100) survives, the near-dup (95) is dropped
        assert [k["frame"] for k in _get_clip(conn, 1)] == [0, 100]

    def test_leaves_clean_clips_untouched(self, conn):
        _insert_clip(conn, 1, [_crop_kf(0), _crop_kf(50), _crop_kf(100)])
        V014CollapseDuplicateKeyframes().up(conn)
        assert [k["frame"] for k in _get_clip(conn, 1)] == [0, 50, 100]

    def test_null_crop_data_is_ignored(self, conn):
        conn.execute("INSERT INTO working_clips (id, crop_data) VALUES (1, NULL)")
        V014CollapseDuplicateKeyframes().up(conn)  # must not raise
        assert _get_clip(conn, 1) is None

    def test_idempotent(self, conn):
        _insert_clip(conn, 1, [_crop_kf(0), _crop_kf(50), _crop_kf(55), _crop_kf(100)])
        V014CollapseDuplicateKeyframes().up(conn)
        first = _get_clip(conn, 1)
        V014CollapseDuplicateKeyframes().up(conn)
        assert _get_clip(conn, 1) == first


class TestMigrationHighlights:
    def test_collapses_duplicate_region_keyframes(self, conn):
        regions = [{
            "id": "r1",
            "keyframes": [_hl_kf(0.0), _hl_kf(1.0), _hl_kf(1.05), _hl_kf(2.0)],
        }]
        conn.execute(
            "INSERT INTO working_videos (id, highlights_data) VALUES (?, ?)",
            (1, encode_data(regions)),
        )
        V014CollapseDuplicateKeyframes().up(conn)

        row = conn.execute(
            "SELECT highlights_data FROM working_videos WHERE id = 1"
        ).fetchone()
        out = decode_data(row[0])
        assert [round(k["time"], 3) for k in out[0]["keyframes"]] == [0.0, 1.0, 2.0]

    def test_leaves_clean_regions_untouched(self, conn):
        regions = [{
            "id": "r1",
            "keyframes": [_hl_kf(0.0), _hl_kf(1.0), _hl_kf(2.0)],
        }]
        conn.execute(
            "INSERT INTO working_videos (id, highlights_data) VALUES (?, ?)",
            (1, encode_data(regions)),
        )
        V014CollapseDuplicateKeyframes().up(conn)
        row = conn.execute(
            "SELECT highlights_data FROM working_videos WHERE id = 1"
        ).fetchone()
        out = decode_data(row[0])
        assert len(out[0]["keyframes"]) == 3
