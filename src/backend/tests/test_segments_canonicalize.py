"""
Tests for canonicalize_segments_data (Bug 20p: slow-mo/realtime reversed in export).

segments_data has two writers with different boundary formats:
- PUT /clips (saveCurrentClipState): boundaries = [0, ...userSplits, duration]
- POST /clips/{id}/actions split_segment: boundaries = [...userSplits] only

segmentSpeeds is always keyed by interval index over the FULL list
[0, ...userSplits, duration]. Export-side consumers walk boundary pairs, so
splits-only rows shifted every speed one interval over: the intended slow-mo
segment played realtime and the following segment played slow-mo.

The fixture data below is the actual production segments_data from the bug
report (sarkarati@gmail.com, project 26).
"""

import pytest

from app.highlight_transform import canonicalize_segments_data, get_output_duration
from app.routers.export.multi_clip import normalize_clip_data_for_modal


# Real prod data: WC 50 — saved via surgical gesture actions (splits-only).
# User intent: middle segment [2.18..5.34] at 0.5x, rest realtime, trim to 19.53.
WC50_SPLITS_ONLY = {
    "boundaries": [2.1828043040009106, 5.340262304001044, 19.528168304001156],
    "segmentSpeeds": {"1": 0.5},
    "trimRange": {"start": 0.0, "end": 19.528168304001156},
}
WC50_DURATION = 21.208761420261908

# Real prod data: WC 55 — same clip saved via PUT (full boundaries).
WC55_FULL = {
    "boundaries": [0, 2.1828043040009106, 5.340262304001044, 19.528168304001156, 21.208761420261908],
    "segmentSpeeds": {"1": 0.5},
    "trimRange": {"start": 0, "end": 19.528168304001156},
}


class TestCanonicalizeSegmentsData:
    def test_splits_only_boundaries_rebuilt_to_full(self):
        result = canonicalize_segments_data(WC50_SPLITS_ONLY, WC50_DURATION)
        assert result["boundaries"] == [
            0.0,
            2.1828043040009106,
            5.340262304001044,
            19.528168304001156,
            WC50_DURATION,
        ]
        # Speeds and trim pass through unchanged
        assert result["segmentSpeeds"] == {"1": 0.5}
        assert result["trimRange"] == WC50_SPLITS_ONLY["trimRange"]

    def test_full_format_passes_through_unchanged(self):
        result = canonicalize_segments_data(WC55_FULL, WC50_DURATION)
        assert result == WC55_FULL

    def test_none_and_empty_pass_through(self):
        assert canonicalize_segments_data(None, 10.0) is None
        assert canonicalize_segments_data({}, 10.0) == {}
        # Trim-only data (no boundaries key) is untouched
        trim_only = {"trimRange": {"start": 1.0, "end": 5.0}}
        assert canonicalize_segments_data(trim_only, 10.0) == trim_only

    def test_input_not_mutated(self):
        original = dict(WC50_SPLITS_ONLY)
        canonicalize_segments_data(WC50_SPLITS_ONLY, WC50_DURATION)
        assert WC50_SPLITS_ONLY == original

    def test_split_at_or_beyond_duration_dropped(self):
        data = {"boundaries": [3.0, 12.0], "segmentSpeeds": {"1": 0.5}}
        result = canonicalize_segments_data(data, 10.0)
        assert result["boundaries"] == [0.0, 3.0, 10.0]

    def test_unsorted_splits_sorted(self):
        data = {"boundaries": [5.0, 2.0], "segmentSpeeds": {"1": 0.5}}
        result = canonicalize_segments_data(data, 10.0)
        assert result["boundaries"] == [0.0, 2.0, 5.0, 10.0]


class TestExportSpeedPlacement:
    """Regression for Bug 20p: speeds must land on the segment the user chose."""

    def test_gesture_saved_clip_slow_mo_lands_on_intended_segment(self):
        # Mirrors the DB-resolved multi-clip export path:
        # decode segments_data -> canonicalize -> normalize for Modal
        clip_data = {
            "clipIndex": 3,
            "duration": WC50_DURATION,
            "segments": canonicalize_segments_data(WC50_SPLITS_ONLY, WC50_DURATION),
        }
        normalized = normalize_clip_data_for_modal(clip_data)
        segs = normalized["segmentsData"]["segments"]

        slow = [s for s in segs if s["speed"] == 0.5]
        assert len(slow) == 1
        # The user slowed [2.18 .. 5.34] — NOT [5.34 .. 19.53]
        assert slow[0]["start"] == pytest.approx(2.1828043040009106)
        assert slow[0]["end"] == pytest.approx(5.340262304001044)

        # Every other interval is realtime
        for s in segs:
            if s is not slow[0]:
                assert s["speed"] == 1.0

    def test_put_saved_clip_unchanged_behavior(self):
        clip_data = {
            "clipIndex": 3,
            "duration": WC50_DURATION,
            "segments": canonicalize_segments_data(WC55_FULL, WC50_DURATION),
        }
        normalized = normalize_clip_data_for_modal(clip_data)
        segs = normalized["segmentsData"]["segments"]
        slow = [s for s in segs if s["speed"] == 0.5]
        assert len(slow) == 1
        assert slow[0]["start"] == pytest.approx(2.1828043040009106)
        assert slow[0]["end"] == pytest.approx(5.340262304001044)

    def test_output_duration_accounts_for_slow_mo(self):
        canonical = canonicalize_segments_data(WC50_SPLITS_ONLY, WC50_DURATION)
        duration = get_output_duration(canonical, WC50_DURATION)
        # trim 0..19.528; [0..2.183]@1x + [2.183..5.340]@0.5x + [5.340..19.528]@1x
        expected = 2.1828043040009106 + (5.340262304001044 - 2.1828043040009106) / 0.5 + (
            19.528168304001156 - 5.340262304001044
        )
        assert duration == pytest.approx(expected)
