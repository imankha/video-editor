"""
Tests for T10060: highlight_carry drops `fromDetection` on a framing re-export.

`fromDetection` is the SOLE marker that a highlight keyframe is a real
player/Spotlight assignment (vs unassigned scaffolding). Before T10060 the
raw<->working geometry transforms (`transform_keyframe_to_raw` /
`transform_keyframe_to_working`) returned a fixed key whitelist that OMITTED
`fromDetection`, so any framing re-export that actually re-transforms the
highlights (crop change, trim, speed change -- single OR multi clip) silently
demoted the assignment back to unassigned, re-opening "Pick your player".

Fix: thread `fromDetection` ADDITIVELY through both transform hops -- the marker
rides with the keyframe through the exact drop/survive logic as the geometry, so
it survives even when the keyframe's TIME shifts (speed/trim change), which a
time-matching merge could not. Additive-only: a keyframe that never had the
marker never gains one (mirrors the T9770 rule for the backend UPDATE branch).

This is the server-side twin of the frontend bug T9780 fixes in
`useHighlightRegions.restoreRegions`.
"""

import pytest

from app.highlight_transform import (
    transform_keyframe_to_raw,
    transform_keyframe_to_working,
)
from app.services.highlight_carry import (
    _transform_multi_clip,
    resolve_carried_highlights,
)


# =============================================================================
# SHARED FIXTURES (mirror test_t4350_highlight_carry.py / test_t4355 conventions)
# =============================================================================


@pytest.fixture
def simple_crop_keyframes():
    return [
        {'frame': 0, 'x': 100, 'y': 50, 'width': 200, 'height': 360},
        {'frame': 450, 'x': 100, 'y': 50, 'width': 200, 'height': 360},
    ]


@pytest.fixture
def shifted_crop_keyframes():
    """A DIFFERENT crop (moved focus point) so the snapshot differs and the
    single-clip transform path actually runs."""
    return [
        {'frame': 0, 'x': 140, 'y': 80, 'width': 200, 'height': 360},
        {'frame': 450, 'x': 140, 'y': 80, 'width': 200, 'height': 360},
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


def _snapshot(clip_count, video_dims, clips, transition=None):
    return {
        'clip_count': clip_count,
        'video_dims': video_dims,
        'clips': clips,
        'transition': transition,
    }


def _region(region_id, start_time, end_time, kf_time=None, from_detection=False):
    if kf_time is None:
        kf_time = start_time
    kf = {
        'time': kf_time,
        'x': 540, 'y': 960,
        'radiusX': 50, 'radiusY': 100,
        'opacity': 0.15,
        'color': '#FFFF00',
    }
    if from_detection:
        kf['fromDetection'] = True
    return {
        'id': region_id,
        'start_time': start_time,
        'end_time': end_time,
        'enabled': True,
        'keyframes': [kf],
    }


NO_MODS = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': None}


# =============================================================================
# AC1: a Spotlight assignment survives a framing re-export that re-transforms.
# =============================================================================


class TestSingleClipCropChangePreservesFromDetection:
    def test_crop_change_preserves_from_detection(self, video_dims, simple_crop_keyframes, shifted_crop_keyframes):
        old_snapshot = _snapshot(1, video_dims, [_clip_entry(NO_MODS, simple_crop_keyframes)])
        new_snapshot = _snapshot(1, video_dims, [_clip_entry(NO_MODS, shifted_crop_keyframes)])
        region = _region('r1', 5.0, 7.0, kf_time=5.0, from_detection=True)

        result, _ = resolve_carried_highlights(
            prior_highlights=[region],
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=[],
            clip_count=1,
        )
        assert len(result) == 1
        kfs = result[0]['keyframes']
        assert len(kfs) == 1
        assert kfs[0].get('fromDetection') is True

    def test_speed_change_shifts_time_but_preserves_from_detection(self, video_dims, simple_crop_keyframes):
        """A speed change SHIFTS the keyframe's working time -- a time-matching
        merge would fail to re-attach the marker here; additive threading does not."""
        old_segments = NO_MODS
        new_segments = {'boundaries': [0.0, 5.0, 15.0], 'segmentSpeeds': {'0': 0.5}, 'trimRange': None}
        old_snapshot = _snapshot(1, video_dims, [_clip_entry(old_segments, simple_crop_keyframes)])
        new_snapshot = _snapshot(1, video_dims, [_clip_entry(new_segments, simple_crop_keyframes)])
        region = _region('r1', 6.0, 8.0, kf_time=6.0, from_detection=True)

        result, _ = resolve_carried_highlights(
            prior_highlights=[region],
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=[],
            clip_count=1,
        )
        assert len(result) == 1
        kfs = result[0]['keyframes']
        assert kfs[0].get('fromDetection') is True
        # geometry/time really did move (marker survived a genuine re-transform)
        assert kfs[0]['time'] != pytest.approx(6.0, abs=0.01)


# =============================================================================
# AC2: a legacy keyframe WITHOUT the marker never gains a false-positive one.
# =============================================================================


class TestAdditiveOnlyNoFalsePositive:
    def test_legacy_keyframe_never_gains_marker(self, video_dims, simple_crop_keyframes, shifted_crop_keyframes):
        old_snapshot = _snapshot(1, video_dims, [_clip_entry(NO_MODS, simple_crop_keyframes)])
        new_snapshot = _snapshot(1, video_dims, [_clip_entry(NO_MODS, shifted_crop_keyframes)])
        region = _region('r1', 5.0, 7.0, kf_time=5.0, from_detection=False)

        result, _ = resolve_carried_highlights(
            prior_highlights=[region],
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=[],
            clip_count=1,
        )
        assert len(result) == 1
        assert 'fromDetection' not in result[0]['keyframes'][0]


# =============================================================================
# AC3: verbatim fast-path & legacy-carry path unaffected (regression).
# =============================================================================


class TestUntransformedPathsUnaffected:
    def test_verbatim_fast_path_returns_prior_marker_intact(self, video_dims, simple_crop_keyframes):
        snapshot = _snapshot(1, video_dims, [_clip_entry(NO_MODS, simple_crop_keyframes)])
        region = _region('r1', 5.0, 7.0, kf_time=5.0, from_detection=True)

        result, note = resolve_carried_highlights(
            prior_highlights=[region],
            prior_snapshot=snapshot,
            new_snapshot=snapshot,  # identical -> verbatim fast path
            detected_regions=[],
            clip_count=1,
        )
        assert note is None
        assert result[0]['keyframes'][0].get('fromDetection') is True

    def test_legacy_uncertain_path_returns_prior_marker_intact(self, video_dims, simple_crop_keyframes):
        new_snapshot = _snapshot(1, video_dims, [_clip_entry(NO_MODS, simple_crop_keyframes)])
        region = _region('r1', 5.0, 7.0, kf_time=5.0, from_detection=True)

        result, note = resolve_carried_highlights(
            prior_highlights=[region],
            prior_snapshot=None,  # no old snapshot -> legacy_uncertain, verbatim carry
            new_snapshot=new_snapshot,
            detected_regions=[],
            clip_count=1,
        )
        assert note == 'legacy_uncertain'
        assert result[0]['keyframes'][0].get('fromDetection') is True


# =============================================================================
# Multi-clip carry preserves the marker too (same transform seam).
# =============================================================================


class TestMultiClipPreservesFromDetection:
    def test_multiclip_crop_change_preserves_from_detection(
        self, video_dims, simple_crop_keyframes, shifted_crop_keyframes
    ):
        old_snapshot = _snapshot(
            2, video_dims,
            [_clip_entry(NO_MODS, simple_crop_keyframes), _clip_entry(NO_MODS, simple_crop_keyframes)],
        )
        new_snapshot = _snapshot(
            2, video_dims,
            [_clip_entry(NO_MODS, shifted_crop_keyframes), _clip_entry(NO_MODS, shifted_crop_keyframes)],
        )
        # region in the SECOND clip (concat offset 15s)
        region = _region('r1', 18.0, 20.0, kf_time=18.0, from_detection=True)

        transformed, dropped = _transform_multi_clip([region], old_snapshot, new_snapshot)
        assert dropped == 0
        assert len(transformed) == 1
        assert transformed[0]['keyframes'][0].get('fromDetection') is True


# =============================================================================
# Unit: the two transform hops thread the marker additively.
# =============================================================================


class TestTransformHopsThreadMarker:
    def test_to_raw_carries_marker_additively(self, video_dims, simple_crop_keyframes):
        kf = {'time': 5.0, 'x': 540, 'y': 960, 'radiusX': 50, 'radiusY': 100,
              'opacity': 0.15, 'color': '#FFFF00', 'fromDetection': True}
        raw = transform_keyframe_to_raw(kf, simple_crop_keyframes, NO_MODS, video_dims, 30.0)
        assert raw is not None
        assert raw.get('fromDetection') is True

    def test_to_raw_omits_marker_when_absent(self, video_dims, simple_crop_keyframes):
        kf = {'time': 5.0, 'x': 540, 'y': 960, 'radiusX': 50, 'radiusY': 100,
              'opacity': 0.15, 'color': '#FFFF00'}
        raw = transform_keyframe_to_raw(kf, simple_crop_keyframes, NO_MODS, video_dims, 30.0)
        assert raw is not None
        assert 'fromDetection' not in raw

    def test_to_working_carries_marker_additively(self, video_dims, simple_crop_keyframes):
        # raw coords must land INSIDE the crop box (x in [100,300], y in [50,410])
        # or the transform marks the keyframe not-visible and returns None.
        raw_kf = {'raw_frame': 150, 'raw_x': 200, 'raw_y': 230, 'raw_radiusX': 30,
                  'raw_radiusY': 40, 'opacity': 0.15, 'color': '#FFFF00', 'fromDetection': True}
        working = transform_keyframe_to_working(raw_kf, simple_crop_keyframes, NO_MODS, video_dims, 30.0)
        assert working is not None
        assert working.get('fromDetection') is True

    def test_to_working_omits_marker_when_absent(self, video_dims, simple_crop_keyframes):
        raw_kf = {'raw_frame': 150, 'raw_x': 200, 'raw_y': 230, 'raw_radiusX': 30,
                  'raw_radiusY': 40, 'opacity': 0.15, 'color': '#FFFF00'}
        working = transform_keyframe_to_working(raw_kf, simple_crop_keyframes, NO_MODS, video_dims, 30.0)
        assert working is not None
        assert 'fromDetection' not in working
