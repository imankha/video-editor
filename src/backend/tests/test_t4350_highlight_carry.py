"""
Tests for app.services.highlight_carry.resolve_carried_highlights (T4350).

T4350: a Framing re-export must PRESERVE the user's overlay-edited highlights
across a re-export rather than silently discarding them for fresh detection.
`resolve_carried_highlights` is the pure decision+transform helper that
implements the L1+L2 decision matrix from docs/plans/tasks/T4350-design.md
section 8 / 8.1 / 8.2 (BINDING).

THIS IS TEST-FIRST: `app/services/highlight_carry.py` does not exist yet.
This whole module is expected to fail collection with an ImportError until
the Implementor creates it.

Decision matrix under test:
1. prior_highlights empty/None            -> (detected_regions, None)               [first-export seed]
2. prior_snapshot == new_snapshot         -> (prior_highlights, None)   VERBATIM     [fast path]
3. clip_count == 1, snapshots differ      -> (transformed, f"dropped:{n}" or None)   [L2 transform]
4. clip_count > 1, snapshots differ       -> (detected_regions, "multiclip_reset")   [loud fallback]
5. clip_count == 1, prior_snapshot is None-> (prior_highlights, "legacy_uncertain")  [legacy carry]
"""

import copy

import pytest

from app.highlight_transform import (
    canonicalize_segments_data,
    source_time_to_working_time,
    working_time_to_source_time,
)

# THE UNIT UNDER TEST — does not exist yet (test-first / expected red).
from app.services.highlight_carry import resolve_carried_highlights


# =============================================================================
# SHARED FIXTURES
# =============================================================================

@pytest.fixture
def simple_crop_keyframes():
    """Constant crop, frame-based (matches stored working_clips.crop_data)."""
    return [
        {'frame': 0, 'x': 100, 'y': 50, 'width': 200, 'height': 360},
        {'frame': 450, 'x': 100, 'y': 50, 'width': 200, 'height': 360},  # 15s @ 30fps
    ]


@pytest.fixture
def video_dims():
    return {'width': 1080, 'height': 1920}


def _clip_entry(segments_data, crop_keyframes, fps=30.0, raw_duration=15.0):
    return {
        'crop_keyframes': crop_keyframes,
        'segments_data': segments_data,
        'fps': fps,
        'raw_duration': raw_duration,
    }


def _snapshot(clip_count, video_dims, clips):
    return {
        'clip_count': clip_count,
        'video_dims': video_dims,
        'clips': clips,
    }


def _region(region_id, start_time, end_time, kf_time=None, x=540, y=960, radiusX=50, radiusY=100):
    """Working-space region with >=1 keyframe inside [start_time, end_time]."""
    if kf_time is None:
        kf_time = start_time
    return {
        'id': region_id,
        'start_time': start_time,
        'end_time': end_time,
        'enabled': True,
        'keyframes': [
            {
                'time': kf_time,
                'x': x, 'y': y,
                'radiusX': radiusX, 'radiusY': radiusY,
                'opacity': 0.15,
                'color': '#FFFF00',
            }
        ],
    }


@pytest.fixture
def detected_regions_sentinel():
    """A sentinel detected_regions list, distinct from any prior_highlights,
    so tests can assert it is (or is not) the thing returned."""
    return [
        {
            'id': 'detected-sentinel',
            'start_time': 99.0,
            'end_time': 100.0,
            'enabled': True,
            'keyframes': [
                {'time': 99.0, 'x': 1, 'y': 1, 'radiusX': 1, 'radiusY': 1, 'opacity': 0.15, 'color': '#FFFF00'}
            ],
        }
    ]


# =============================================================================
# CASE 1: first-export seed (no prior highlights)
# =============================================================================

class TestFirstExportSeed:
    def test_none_prior_highlights_returns_detected(self, video_dims, simple_crop_keyframes, detected_regions_sentinel):
        no_mods = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': None}
        new_snapshot = _snapshot(1, video_dims, [_clip_entry(no_mods, simple_crop_keyframes)])

        result, note = resolve_carried_highlights(
            prior_highlights=None,
            prior_snapshot=None,
            new_snapshot=new_snapshot,
            detected_regions=detected_regions_sentinel,
            clip_count=1,
        )

        assert result == detected_regions_sentinel
        assert note is None

    def test_empty_prior_highlights_returns_detected(self, video_dims, simple_crop_keyframes, detected_regions_sentinel):
        no_mods = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': None}
        new_snapshot = _snapshot(1, video_dims, [_clip_entry(no_mods, simple_crop_keyframes)])

        result, note = resolve_carried_highlights(
            prior_highlights=[],
            prior_snapshot=None,
            new_snapshot=new_snapshot,
            detected_regions=detected_regions_sentinel,
            clip_count=1,
        )

        assert result == detected_regions_sentinel
        assert note is None


# =============================================================================
# CASE 2: fast path (identical framing snapshot)
# =============================================================================

class TestFastPathIdentity:
    def test_identical_snapshot_returns_prior_verbatim(self, video_dims, simple_crop_keyframes, detected_regions_sentinel):
        no_mods = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': None}
        snapshot = _snapshot(1, video_dims, [_clip_entry(no_mods, simple_crop_keyframes)])
        # new_snapshot is a deep-equal but distinct object, proving comparison is by value
        new_snapshot = copy.deepcopy(snapshot)

        prior_highlights = [_region('r1', 2.0, 5.0)]

        result, note = resolve_carried_highlights(
            prior_highlights=prior_highlights,
            prior_snapshot=snapshot,
            new_snapshot=new_snapshot,
            detected_regions=detected_regions_sentinel,
            clip_count=1,
        )

        assert result == prior_highlights
        assert note is None
        # detected_regions must NOT be used on the fast path
        assert result != detected_regions_sentinel
        for r in result:
            assert r['id'] != 'detected-sentinel'


# =============================================================================
# CASE 3: single-clip transform (trim-shift / trim-removal / speed-change)
# =============================================================================

class TestSingleClipTransformTrimShift:
    def test_trim_shift_survives_with_shifted_time(self, video_dims, simple_crop_keyframes, detected_regions_sentinel):
        """OLD had no trim; NEW trims the first 2s off. A region that sits on a
        surviving moment must SURVIVE and its start_time must reflect the shift."""
        old_segments = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': None}
        new_segments = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': {'start': 2.0, 'end': 15.0}}

        old_snapshot = _snapshot(1, video_dims, [_clip_entry(old_segments, simple_crop_keyframes)])
        new_snapshot = _snapshot(1, video_dims, [_clip_entry(new_segments, simple_crop_keyframes)])

        # OLD working-space region at [5.0, 7.0] -> OLD source_time [5.0, 7.0] (no trim)
        # NEW trim starts at source 2.0, so NEW working_time = source_time - 2.0 -> [3.0, 5.0]
        prior_highlights = [_region('r1', 5.0, 7.0, kf_time=5.0)]

        result, note = resolve_carried_highlights(
            prior_highlights=prior_highlights,
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=detected_regions_sentinel,
            clip_count=1,
        )

        assert note is None
        assert len(result) == 1
        r = result[0]
        assert r['id'] == 'r1'
        # expected via the same helpers the transform uses, not a hardcoded magic number
        old_canon = canonicalize_segments_data(old_segments, 15.0)
        new_canon = canonicalize_segments_data(new_segments, 15.0)
        source_start = working_time_to_source_time(5.0, old_canon)
        expected_new_start = source_time_to_working_time(source_start, new_canon)
        assert r['start_time'] == pytest.approx(expected_new_start, abs=0.05)


class TestSingleClipTransformPreservesMetadata:
    def test_region_level_metadata_survives_transform(self, video_dims, simple_crop_keyframes, detected_regions_sentinel):
        """A framing-change transform must preserve region-level metadata (label,
        color) that the geometry-only transform would otherwise drop."""
        old_segments = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': None}
        new_segments = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': {'start': 2.0, 'end': 15.0}}
        old_snapshot = _snapshot(1, video_dims, [_clip_entry(old_segments, simple_crop_keyframes)])
        new_snapshot = _snapshot(1, video_dims, [_clip_entry(new_segments, simple_crop_keyframes)])

        region = _region('r1', 5.0, 7.0, kf_time=5.0)
        region['label'] = 'Great play'
        region['color'] = '#00FF00'
        region['shape'] = 'circle'

        result, _ = resolve_carried_highlights(
            prior_highlights=[region],
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=detected_regions_sentinel,
            clip_count=1,
        )
        assert len(result) == 1
        r = result[0]
        assert r['label'] == 'Great play'
        assert r['color'] == '#00FF00'
        assert r['shape'] == 'circle'
        # geometry still came from the transform (shifted), not the stale original
        assert r['start_time'] != pytest.approx(5.0, abs=0.01)


class TestSingleClipTransformTrimRemoval:
    def test_region_inside_removed_span_is_dropped_other_survives(self, video_dims, simple_crop_keyframes, detected_regions_sentinel):
        """NEW trim removes [8, 15]. A region entirely inside that span is DROPPED;
        note reflects the drop count. A region outside the removed span survives."""
        old_segments = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': None}
        new_segments = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': {'start': 0.0, 'end': 8.0}}

        old_snapshot = _snapshot(1, video_dims, [_clip_entry(old_segments, simple_crop_keyframes)])
        new_snapshot = _snapshot(1, video_dims, [_clip_entry(new_segments, simple_crop_keyframes)])

        dropped_region = _region('dropped-1', 10.0, 12.0, kf_time=10.0)   # entirely inside removed [8,15]
        surviving_region = _region('surv-1', 1.0, 3.0, kf_time=1.0)       # inside kept [0,8]

        prior_highlights = [dropped_region, surviving_region]

        result, note = resolve_carried_highlights(
            prior_highlights=prior_highlights,
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=detected_regions_sentinel,
            clip_count=1,
        )

        assert note == "dropped:1"
        result_ids = {r['id'] for r in result}
        assert 'dropped-1' not in result_ids
        assert 'surv-1' in result_ids
        assert len(result) == 1


class TestSingleClipTransformSpeedChange:
    def test_speed_change_scales_surviving_region_time(self, video_dims, simple_crop_keyframes, detected_regions_sentinel):
        """OLD has no speed changes; NEW applies 0.5x to the middle segment
        (5-10s source). A region inside that segment must have its working-space
        time scaled per the speed model."""
        old_segments = {'boundaries': [0.0, 5.0, 10.0, 15.0], 'segmentSpeeds': {}, 'trimRange': None}
        new_segments = {'boundaries': [0.0, 5.0, 10.0, 15.0], 'segmentSpeeds': {'1': 0.5}, 'trimRange': None}

        old_snapshot = _snapshot(1, video_dims, [_clip_entry(old_segments, simple_crop_keyframes)])
        new_snapshot = _snapshot(1, video_dims, [_clip_entry(new_segments, simple_crop_keyframes)])

        # OLD working_time 7.0 -> OLD source_time 7.0 (no speed mods, 1:1)
        prior_highlights = [_region('r1', 7.0, 8.0, kf_time=7.0)]

        result, note = resolve_carried_highlights(
            prior_highlights=prior_highlights,
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=detected_regions_sentinel,
            clip_count=1,
        )

        assert note is None
        assert len(result) == 1
        r = result[0]

        old_canon = canonicalize_segments_data(old_segments, 15.0)
        new_canon = canonicalize_segments_data(new_segments, 15.0)
        source_start = working_time_to_source_time(7.0, old_canon)
        expected_new_start = source_time_to_working_time(source_start, new_canon)

        # sanity: the speed change must actually move the expected time vs the
        # naive (unscaled) 7.0, otherwise this test can't distinguish a bug
        # that skips scaling entirely.
        assert expected_new_start != pytest.approx(7.0, abs=0.001)
        assert r['start_time'] == pytest.approx(expected_new_start, abs=0.05)


# =============================================================================
# CASE 4: multi-clip loud fallback
# =============================================================================

class TestMultiClipReset:
    """T4350 shipped multi-clip as an unconditional loud reset (Gap B). T4355
    (docs/plans/tasks/T4355-design.md, approved) closes that gap: a multi-clip
    framing change now transforms per-clip instead of always resetting: see
    tests/test_t4355_multiclip_carry.py for the full per-clip fixture matrix.
    `multiclip_reset` survives ONLY as the residual genuinely-unmappable case
    (a legacy prior snapshot with no `transition` key, on a NEW-side dissolve
    re-export -- covered by TestDissolveTransition in the T4355 test file, not
    here). This test is kept to lock the now-CORRECT "trim-only multi-clip
    change transforms, does not reset" behavior at the `resolve_carried_highlights`
    entry point, mirroring T4350's own single-clip trim-shift test shape.
    """

    def test_multiclip_trim_change_transforms_not_resets(
        self, video_dims, simple_crop_keyframes, detected_regions_sentinel
    ):
        segs_a = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': None}
        segs_b = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': {'start': 1.0, 'end': 14.0}}

        old_snapshot = _snapshot(2, video_dims, [
            _clip_entry(segs_a, simple_crop_keyframes),
            _clip_entry(segs_a, simple_crop_keyframes),
        ])
        new_snapshot = _snapshot(2, video_dims, [
            _clip_entry(segs_b, simple_crop_keyframes),
            _clip_entry(segs_b, simple_crop_keyframes),
        ])

        prior_highlights = [_region('r1', 2.0, 5.0)]

        result, note = resolve_carried_highlights(
            prior_highlights=prior_highlights,
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=detected_regions_sentinel,
            clip_count=2,
        )

        assert note != "multiclip_reset"
        assert result != detected_regions_sentinel
        assert len(result) == 1
        assert result[0]['id'] == 'r1'
        # Ground truth via the SAME production helpers the transform uses (never
        # a hardcoded magic number): region is in clip 0 (old offset 0), untouched
        # by the trim change -> old->raw->new mirrors T4350's own single-clip math.
        old_canon = canonicalize_segments_data(segs_a, 15.0)
        new_canon = canonicalize_segments_data(segs_b, 15.0)
        expected_start = source_time_to_working_time(working_time_to_source_time(2.0, old_canon), new_canon)
        expected_end = source_time_to_working_time(working_time_to_source_time(5.0, old_canon), new_canon)
        assert result[0]['start_time'] == pytest.approx(expected_start, abs=0.05)
        assert result[0]['end_time'] == pytest.approx(expected_end, abs=0.05)


# =============================================================================
# CASE 5: legacy uncertain (no prior snapshot, single-clip, prior highlights exist)
# =============================================================================

class TestLegacyUncertain:
    def test_missing_prior_snapshot_carries_verbatim_with_notice(
        self, video_dims, simple_crop_keyframes, detected_regions_sentinel
    ):
        no_mods = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': None}
        new_snapshot = _snapshot(1, video_dims, [_clip_entry(no_mods, simple_crop_keyframes)])

        prior_highlights = [_region('r1', 2.0, 5.0)]

        result, note = resolve_carried_highlights(
            prior_highlights=prior_highlights,
            prior_snapshot=None,
            new_snapshot=new_snapshot,
            detected_regions=detected_regions_sentinel,
            clip_count=1,
        )

        assert result == prior_highlights
        assert note == "legacy_uncertain"
