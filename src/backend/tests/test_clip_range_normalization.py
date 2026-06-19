"""Tests for clip range normalization (bug 23p).

Covers the normalize_clip_range helper and the v012 migration that flips
existing inverted raw_clips ranges so start_time <= end_time always holds.
"""

import sqlite3

import pytest

from app.utils.clip_range import normalize_clip_range
from app.migrations.profile_db.v012_flip_inverted_clip_ranges import V012FlipInvertedClipRanges


class TestNormalizeClipRange:
    def test_inverted_range_is_swapped(self):
        assert normalize_clip_range(3998.0, 3959.0) == (3959.0, 3998.0)

    def test_ordered_range_unchanged(self):
        assert normalize_clip_range(10.0, 15.0) == (10.0, 15.0)

    def test_equal_range_unchanged(self):
        # Zero-length is not inverted; the helper leaves it alone.
        assert normalize_clip_range(7.0, 7.0) == (7.0, 7.0)

    def test_none_start_unchanged(self):
        assert normalize_clip_range(None, 5.0) == (None, 5.0)

    def test_none_end_unchanged(self):
        assert normalize_clip_range(5.0, None) == (5.0, None)

    def test_both_none_unchanged(self):
        assert normalize_clip_range(None, None) == (None, None)


class TestV012FlipInvertedClipRanges:
    def _make_db(self, with_boundaries_version=True):
        conn = sqlite3.connect(":memory:")
        bv = "boundaries_version INTEGER DEFAULT 1," if with_boundaries_version else ""
        conn.execute(f"""
            CREATE TABLE raw_clips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time REAL,
                end_time REAL,
                {bv}
                rating INTEGER
            )
        """)
        return conn

    def _insert(self, conn, start, end):
        conn.execute(
            "INSERT INTO raw_clips (start_time, end_time, rating) VALUES (?, ?, 3)",
            (start, end),
        )
        return conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    def _range(self, conn, clip_id):
        row = conn.execute(
            "SELECT start_time, end_time FROM raw_clips WHERE id = ?", (clip_id,)
        ).fetchone()
        return (row[0], row[1])

    def test_flips_inverted_leaves_others(self):
        conn = self._make_db()
        inverted = self._insert(conn, 3998.0, 3959.0)
        ordered = self._insert(conn, 10.0, 15.0)
        equal = self._insert(conn, 7.0, 7.0)
        null_start = self._insert(conn, None, 5.0)

        V012FlipInvertedClipRanges().up(conn)

        assert self._range(conn, inverted) == (3959.0, 3998.0)  # swapped
        assert self._range(conn, ordered) == (10.0, 15.0)       # untouched
        assert self._range(conn, equal) == (7.0, 7.0)           # untouched
        assert self._range(conn, null_start) == (None, 5.0)     # untouched

    def test_bumps_boundaries_version_on_flip(self):
        conn = self._make_db(with_boundaries_version=True)
        inverted = self._insert(conn, 100.0, 50.0)
        ordered = self._insert(conn, 1.0, 2.0)

        V012FlipInvertedClipRanges().up(conn)

        bv_inv = conn.execute(
            "SELECT boundaries_version FROM raw_clips WHERE id = ?", (inverted,)
        ).fetchone()[0]
        bv_ord = conn.execute(
            "SELECT boundaries_version FROM raw_clips WHERE id = ?", (ordered,)
        ).fetchone()[0]
        assert bv_inv == 2  # bumped from default 1
        assert bv_ord == 1  # untouched

    def test_idempotent(self):
        conn = self._make_db()
        inverted = self._insert(conn, 100.0, 50.0)

        V012FlipInvertedClipRanges().up(conn)
        assert self._range(conn, inverted) == (50.0, 100.0)
        # Second run must not re-swap (no row is inverted anymore).
        V012FlipInvertedClipRanges().up(conn)
        assert self._range(conn, inverted) == (50.0, 100.0)

    def test_works_without_boundaries_version_column(self):
        conn = self._make_db(with_boundaries_version=False)
        inverted = self._insert(conn, 100.0, 50.0)

        V012FlipInvertedClipRanges().up(conn)
        assert self._range(conn, inverted) == (50.0, 100.0)

    def test_no_raw_clips_table_is_noop(self):
        conn = sqlite3.connect(":memory:")
        # Should not raise when the table is absent.
        V012FlipInvertedClipRanges().up(conn)
