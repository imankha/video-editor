"""
Tests for multi-clip highlight carry-forward (T4355).

T4350 built the whole carry machine but stopped short for multi-clip re-exports
-- `resolve_carried_highlights` always returned the loud `multiclip_reset`
fallback when `clip_count > 1`. T4355 replaces that branch with a per-clip
transform: attribute each region to its OLD clip via OLD concat offsets,
subtract the offset, run the SAME old->raw->new transform T4350 already
composes (but per-clip instead of hard-indexed to clips[0]), then add the
NEW clip's concat offset back in.

See docs/plans/tasks/T4355-design.md sections 3 (Decisions 1-4), 5 (impl plan
table), 6 (test plan) for the exact rules under test here.

THIS IS TEST-FIRST: the units under test do not exist yet.
- `app.services.highlight_carry._transform_multi_clip` -- does not exist.
- `app.routers.export.multi_clip.concat_offsets` -- does not exist (the
  shared offset helper the design says to extract, Decision 3 / plan table).
- `resolve_carried_highlights`'s NEW decision order (design Decision 4 step 3
  promotes legacy-any-clip-count above the clip_count split; step 5 calls
  `_transform_multi_clip` for clip_count > 1 instead of always resetting).

This whole module is expected to fail collection (ImportError) or fail
individual assertions (old reset-always behavior) until the Implementor
lands T4355.

Assumed signatures the Implementor should build to:
    _transform_multi_clip(prior_highlights: list[dict], prior_snapshot: dict,
                           new_snapshot: dict) -> tuple[list[dict], int]
        Same contract as `_transform_single_clip`: returns (transformed_regions,
        dropped_count). dropped counts ENABLED prior regions only.

    concat_offsets(snapshot: dict) -> list[float]
        snapshot is the DECODED framing snapshot dict (clip_count, video_dims,
        clips:[...], optional "transition": {"type","duration"} | None).
        Returns per-clip OLD-side (or NEW-side, same function either way)
        concat offsets in seconds: off_i = sum of get_output_duration(...) for
        clips before i, with dissolve overlap subtracted per Decision 2/3.
        Absent/None "transition" key => treated as "cut" (Decision 2).
"""

import pytest

from app.highlight_transform import (
    canonicalize_segments_data,
    get_output_duration,
    source_time_to_working_time,
    transform_all_regions_to_raw,
    transform_all_regions_to_working,
    working_time_to_source_time,
)

# THE UNITS UNDER TEST -- do not exist yet (test-first / expected red).
from app.routers.export.multi_clip import concat_offsets
from app.services.highlight_carry import (
    NOTE_MULTICLIP_RESET,
    _transform_multi_clip,
    resolve_carried_highlights,
)

# =============================================================================
# SHARED FIXTURES (mirrors test_t4350_highlight_carry.py conventions exactly)
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


def _snapshot(clip_count, video_dims, clips, transition=None):
    return {
        'clip_count': clip_count,
        'video_dims': video_dims,
        'clips': clips,
        'transition': transition,
    }


def _region(region_id, start_time, end_time, kf_time=None, x=540, y=960, radiusX=50, radiusY=100, enabled=True):
    """Working-space (concatenated) region with >=1 keyframe inside [start_time, end_time]."""
    if kf_time is None:
        kf_time = start_time
    return {
        'id': region_id,
        'start_time': start_time,
        'end_time': end_time,
        'enabled': enabled,
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


NO_MODS_15 = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': None}


def _expected_single_clip_transform(old_segments, new_segments, old_start, raw_duration=15.0):
    """Compute the expected NEW start via the SAME helpers the transform uses
    (never a hardcoded magic number), matching T4350's test convention."""
    old_canon = canonicalize_segments_data(old_segments, raw_duration)
    new_canon = canonicalize_segments_data(new_segments, raw_duration)
    source_start = working_time_to_source_time(old_start, old_canon)
    return source_time_to_working_time(source_start, new_canon)


# =============================================================================
# concat_offsets: shared helper (Decision 3 "extract ONE concat_offsets")
# =============================================================================


class TestConcatOffsets:
    def test_cut_offsets_are_cumulative_output_durations(self, video_dims, simple_crop_keyframes):
        """3 clips, no trims, 'cut' transition (or no transition key) -> offsets
        are the running sum of each clip's get_output_duration (15s each)."""
        clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes, raw_duration=15.0) for _ in range(3)]
        snapshot = _snapshot(3, video_dims, clips, transition={'type': 'cut', 'duration': 0.0})

        offsets = concat_offsets(snapshot)

        assert len(offsets) == 3
        assert offsets[0] == pytest.approx(0.0, abs=0.01)
        assert offsets[1] == pytest.approx(15.0, abs=0.01)
        assert offsets[2] == pytest.approx(30.0, abs=0.01)

    def test_absent_transition_key_treated_as_cut(self, video_dims, simple_crop_keyframes):
        """Legacy snapshot with no 'transition' key at all (not even None) ->
        Decision 2: absent key => assume cut, no silent guess at overlap."""
        clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes, raw_duration=15.0) for _ in range(2)]
        snapshot = {'clip_count': 2, 'video_dims': video_dims, 'clips': clips}  # no 'transition' key

        offsets = concat_offsets(snapshot)

        assert offsets[0] == pytest.approx(0.0, abs=0.01)
        assert offsets[1] == pytest.approx(15.0, abs=0.01)

    def test_dissolve_offsets_subtract_overlap(self, video_dims, simple_crop_keyframes):
        """Dissolve transition with 0.5s overlap -> each clip after the first
        starts 0.5s earlier than the plain cumulative sum."""
        clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes, raw_duration=15.0) for _ in range(3)]
        snapshot = _snapshot(3, video_dims, clips, transition={'type': 'dissolve', 'duration': 0.5})

        offsets = concat_offsets(snapshot)

        assert offsets[0] == pytest.approx(0.0, abs=0.01)
        assert offsets[1] == pytest.approx(14.5, abs=0.01)  # 15.0 - 0.5 overlap
        assert offsets[2] == pytest.approx(29.0, abs=0.01)  # 14.5 + 15.0 - 0.5

    def test_offsets_use_get_output_duration_with_trim(self, video_dims, simple_crop_keyframes):
        """A trimmed clip's contribution to the next clip's offset reflects
        get_output_duration, not raw_duration -- same Sigma the boundary
        builders (build_clip_boundaries_from_input) and NEW-side use."""
        trimmed = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': {'start': 0.0, 'end': 10.0}}
        clips = [
            _clip_entry(trimmed, simple_crop_keyframes, raw_duration=15.0),
            _clip_entry(NO_MODS_15, simple_crop_keyframes, raw_duration=15.0),
        ]
        snapshot = _snapshot(2, video_dims, clips, transition={'type': 'cut', 'duration': 0.0})

        offsets = concat_offsets(snapshot)

        expected_clip0_duration = get_output_duration(trimmed, 15.0)
        assert expected_clip0_duration == pytest.approx(10.0, abs=0.01)
        assert offsets[0] == pytest.approx(0.0, abs=0.01)
        assert offsets[1] == pytest.approx(expected_clip0_duration, abs=0.01)


# =============================================================================
# AC-1: offset-only shift -- highlight on clip 2 of 3, trim applied to clip 1
# only -> clip-2 region SURVIVES, re-emitted at the NEW offset (not reset).
# =============================================================================


class TestOffsetOnlyShift:
    def test_region_on_untouched_clip_survives_at_new_offset(self, video_dims, simple_crop_keyframes):
        """3 identical 15s clips, cut transition. OLD offsets: [0, 15, 30].
        NEW: clip 0 trimmed to 10s (removing its last 5s) -> NEW offsets:
        [0, 10, 25]. A region entirely inside clip 1 (OLD [15,30)) must
        SURVIVE, re-emitted shifted by -5s (the offset delta), NOT reset."""
        old_clip0_segs = NO_MODS_15
        new_clip0_segs = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': {'start': 0.0, 'end': 10.0}}

        old_clips = [
            _clip_entry(old_clip0_segs, simple_crop_keyframes),
            _clip_entry(NO_MODS_15, simple_crop_keyframes),
            _clip_entry(NO_MODS_15, simple_crop_keyframes),
        ]
        new_clips = [
            _clip_entry(new_clip0_segs, simple_crop_keyframes),
            _clip_entry(NO_MODS_15, simple_crop_keyframes),
            _clip_entry(NO_MODS_15, simple_crop_keyframes),
        ]
        old_snapshot = _snapshot(3, video_dims, old_clips, transition={'type': 'cut', 'duration': 0.0})
        new_snapshot = _snapshot(3, video_dims, new_clips, transition={'type': 'cut', 'duration': 0.0})

        # Region fully inside clip 1's OLD span [15, 30): local time [5,7] within clip 1.
        prior_highlights = [_region('r1', 20.0, 22.0, kf_time=20.0)]

        result, note = resolve_carried_highlights(
            prior_highlights=prior_highlights,
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=[{'id': 'detected-sentinel'}],
            clip_count=3,
        )

        assert note != NOTE_MULTICLIP_RESET
        assert len(result) == 1
        r = result[0]
        assert r['id'] == 'r1'
        # clip1 has no framing change itself, so local geometry is unchanged;
        # only the concat offset shifts: NEW start = 10 (new off_1) + 5 (local) = 15.
        assert r['start_time'] == pytest.approx(15.0, abs=0.05)

    def test_transform_multi_clip_directly(self, video_dims, simple_crop_keyframes):
        """Same scenario, calling _transform_multi_clip directly (unit-level,
        bypassing the resolve_carried_highlights decision wrapper)."""
        old_clip0_segs = NO_MODS_15
        new_clip0_segs = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': {'start': 0.0, 'end': 10.0}}
        old_clips = [
            _clip_entry(old_clip0_segs, simple_crop_keyframes),
            _clip_entry(NO_MODS_15, simple_crop_keyframes),
            _clip_entry(NO_MODS_15, simple_crop_keyframes),
        ]
        new_clips = [
            _clip_entry(new_clip0_segs, simple_crop_keyframes),
            _clip_entry(NO_MODS_15, simple_crop_keyframes),
            _clip_entry(NO_MODS_15, simple_crop_keyframes),
        ]
        old_snapshot = _snapshot(3, video_dims, old_clips, transition={'type': 'cut', 'duration': 0.0})
        new_snapshot = _snapshot(3, video_dims, new_clips, transition={'type': 'cut', 'duration': 0.0})
        prior_highlights = [_region('r1', 20.0, 22.0, kf_time=20.0)]

        result, dropped = _transform_multi_clip(prior_highlights, old_snapshot, new_snapshot)

        assert dropped == 0
        assert len(result) == 1
        assert result[0]['start_time'] == pytest.approx(15.0, abs=0.05)


# =============================================================================
# AC-2: same-clip timing change -- highlight on the clip whose speed/trim
# changed -> transforms old->raw->new same as single-clip path.
# =============================================================================


class TestSameClipTimingChange:
    def test_region_on_changed_clip_transforms_like_single_clip(self, video_dims, simple_crop_keyframes):
        """2 clips. Clip 1 (index 1) gets a 2s trim-shift on the NEW side.
        A region inside clip 1 must transform exactly as the single-clip path
        would transform it in isolation (old->raw->new), then be re-offset."""
        old_clip1_segs = NO_MODS_15
        new_clip1_segs = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': {'start': 2.0, 'end': 15.0}}

        old_clips = [
            _clip_entry(NO_MODS_15, simple_crop_keyframes),
            _clip_entry(old_clip1_segs, simple_crop_keyframes),
        ]
        new_clips = [
            _clip_entry(NO_MODS_15, simple_crop_keyframes),
            _clip_entry(new_clip1_segs, simple_crop_keyframes),
        ]
        old_snapshot = _snapshot(2, video_dims, old_clips, transition={'type': 'cut', 'duration': 0.0})
        new_snapshot = _snapshot(2, video_dims, new_clips, transition={'type': 'cut', 'duration': 0.0})

        # OLD off_1 = 15.0 (clip 0 is 15s). Region local OLD time = 5.0 -> global 20.0.
        prior_highlights = [_region('r1', 20.0, 22.0, kf_time=20.0)]

        result, note = resolve_carried_highlights(
            prior_highlights=prior_highlights,
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=[{'id': 'detected-sentinel'}],
            clip_count=2,
        )

        assert note != NOTE_MULTICLIP_RESET
        assert len(result) == 1
        r = result[0]
        assert r['id'] == 'r1'

        expected_local_new = _expected_single_clip_transform(old_clip1_segs, new_clip1_segs, old_start=5.0)
        # NEW off_1: clip 0 unchanged (15s) since clip0 has no trim on either side.
        new_off_1 = get_output_duration(NO_MODS_15, 15.0)
        expected_global_new = new_off_1 + expected_local_new
        assert r['start_time'] == pytest.approx(expected_global_new, abs=0.05)


# =============================================================================
# AC-3: clip removed -- highlight on a clip dropped from the concat -> DROP +
# dropped:N, loud.
# =============================================================================


class TestClipRemoved:
    def test_region_on_removed_clip_is_dropped(self, video_dims, simple_crop_keyframes):
        """OLD has 3 clips; NEW has only 2 (clip index 2 removed). A region
        attributed to OLD clip 2 must DROP (index no longer exists in NEW),
        and the note must report the drop count, never a silent reset."""
        old_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(3)]
        new_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]
        old_snapshot = _snapshot(3, video_dims, old_clips, transition={'type': 'cut', 'duration': 0.0})
        new_snapshot = _snapshot(2, video_dims, new_clips, transition={'type': 'cut', 'duration': 0.0})

        # clip 2 OLD span = [30, 45)
        dropped_region = _region('dropped-1', 32.0, 34.0, kf_time=32.0)
        # clip 0 OLD span = [0, 15) survives unaffected
        surviving_region = _region('surv-1', 2.0, 4.0, kf_time=2.0)

        result, note = resolve_carried_highlights(
            prior_highlights=[dropped_region, surviving_region],
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=[{'id': 'detected-sentinel'}],
            clip_count=3,
        )

        assert note == "dropped:1"
        result_ids = {r['id'] for r in result}
        assert 'dropped-1' not in result_ids
        assert 'surv-1' in result_ids
        assert len(result) == 1


# =============================================================================
# Reorder: two clips swapped -> region on the moved clip drops+flags (never
# silently re-placed on the wrong clip). Positional-only identity limitation.
# =============================================================================


class TestReorder:
    def test_reordered_clip_region_drops_or_flags_not_silently_relocated(self, video_dims, simple_crop_keyframes):
        """OLD: [A (no trim), B (trimmed to 5s)]. NEW: same clip DATA but
        POSITIONALLY SWAPPED: [B (trimmed to 5s), A (no trim)]. A region
        attributed to OLD position 0 (clip A, span [0,15)) is transformed
        against NEW position 0 -- which is now clip B's (trimmed) framing.
        Since the snapshot has no stable clip id, this must DROP + count
        (raw geometry from A typically won't survive B's trim/crop), never
        silently reappear correctly placed on the wrong source clip."""
        clip_a_segs = NO_MODS_15
        clip_b_segs = {'boundaries': [0.0, 15.0], 'segmentSpeeds': {}, 'trimRange': {'start': 0.0, 'end': 5.0}}
        # Distinct crop geometry per clip so a wrong-clip transform is detectable
        # (not just "same numbers by coincidence").
        crop_a = simple_crop_keyframes
        crop_b = [
            {'frame': 0, 'x': 400, 'y': 300, 'width': 100, 'height': 180},
            {'frame': 450, 'x': 400, 'y': 300, 'width': 100, 'height': 180},
        ]

        old_clips = [_clip_entry(clip_a_segs, crop_a), _clip_entry(clip_b_segs, crop_b)]
        new_clips = [_clip_entry(clip_b_segs, crop_b), _clip_entry(clip_a_segs, crop_a)]  # SWAPPED
        old_snapshot = _snapshot(2, video_dims, old_clips, transition={'type': 'cut', 'duration': 0.0})
        new_snapshot = _snapshot(2, video_dims, new_clips, transition={'type': 'cut', 'duration': 0.0})

        # Region at OLD global time 10.0 -> local clip-A time 10.0 (near the end,
        # outside clip B's [0,5) trim window when reinterpreted positionally) so
        # the transform against NEW position 0 (clip B) cannot survive cleanly.
        moved_region = _region('moved-1', 10.0, 11.0, kf_time=10.0)

        result, note = resolve_carried_highlights(
            prior_highlights=[moved_region],
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=[{'id': 'detected-sentinel'}],
            clip_count=2,
        )

        result_ids = {r['id'] for r in result}
        # Never silently correctly relocated onto clip A's new position with
        # clip A's geometry intact as if nothing happened AND unflagged.
        if 'moved-1' in result_ids:
            assert note is not None and note != None  # noqa: E711 - must be flagged, not silent
        else:
            assert note == "dropped:1"


# =============================================================================
# Straddle: region starting in clip i, ending in clip i+1 -> attributed to i,
# end clamped, logged; drops if collapses to end<=start.
# =============================================================================


class TestStraddle:
    def test_straddling_region_attributed_to_start_clip_and_end_clamped(self, video_dims, simple_crop_keyframes):
        """2 identical 15s clips, cut. Region [12, 17] straddles the clip0/clip1
        boundary (off_1=15). Attributed to clip 0 (by start=12), end clamped to
        15 (clip 0's OLD span end) before transform -> local OLD [12,15]."""
        old_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]
        new_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]
        old_snapshot = _snapshot(2, video_dims, old_clips, transition={'type': 'cut', 'duration': 0.0})
        new_snapshot = _snapshot(2, video_dims, new_clips, transition={'type': 'cut', 'duration': 0.0})

        straddling = _region('straddle-1', 12.0, 17.0, kf_time=12.0)

        result, dropped = _transform_multi_clip([straddling], old_snapshot, new_snapshot)

        assert dropped == 0
        assert len(result) == 1
        r = result[0]
        # No framing change at all here, so global time is unchanged EXCEPT the
        # end must have been clamped to clip 0's span end (15.0), not left at 17.0.
        assert r['start_time'] == pytest.approx(12.0, abs=0.05)
        assert r['end_time'] == pytest.approx(15.0, abs=0.05)
        assert r['end_time'] < 17.0

    def test_straddle_clamp_collapse_drops(self, video_dims, simple_crop_keyframes):
        """A region that starts essentially AT the clip boundary and whose
        clamped span collapses to <=0 length must DROP + count, not raise or
        silently vanish without being counted."""
        old_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]
        new_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]
        old_snapshot = _snapshot(2, video_dims, old_clips, transition={'type': 'cut', 'duration': 0.0})
        new_snapshot = _snapshot(2, video_dims, new_clips, transition={'type': 'cut', 'duration': 0.0})

        # start_time == off_1 - epsilon so it attributes to clip 0, but the
        # clamp to clip 0's span end (15.0) collapses the region to ~0 length.
        collapsing = _region('collapse-1', 14.999, 20.0, kf_time=14.999)

        result, dropped = _transform_multi_clip([collapsing], old_snapshot, new_snapshot)

        assert dropped == 1
        assert result == []


# =============================================================================
# Boundary-exact: start_time == off_i attributes to clip i (half-open), never
# clip i-1.
# =============================================================================


class TestBoundaryExact:
    def test_start_exactly_on_boundary_attributes_to_later_clip(self, video_dims, simple_crop_keyframes):
        """2 clips, clip 0 spans OLD [0,15), clip 1 spans OLD [15,30). A region
        with start_time == 15.0 EXACTLY must attribute to clip 1 (half-open
        [off_i, off_i+dur_i)), never clip 0.

        Local raw time 0 (the very start of whichever clip a region attributes
        to) is invariant under a timing-only change (trim/speed) that doesn't
        remove the start itself -- a trim change makes a poor distinguishing
        signal here, since a trim starting after 0 makes the WHOLE region
        unresolvable (both ends before the visible window) and drops instead
        of moving, which is a straddle/drop scenario, not this one. Use a
        distinguishing CROP instead: clip 1's NEW crop is shifted from clip
        0's (and from clip 1's OLD crop), so the resulting keyframe geometry
        reveals which clip's transform actually ran, independent of timing.
        """
        # Shifted just enough to move the keyframe's interpolated position
        # (not so far that the point falls outside the new crop rect, which
        # would drop it for an unrelated reason -- crop x:100->150 keeps
        # raw_x=200 inside [150,350]).
        distinguishing_crop = [
            {'frame': 0, 'x': 150, 'y': 50, 'width': 200, 'height': 360},
            {'frame': 450, 'x': 150, 'y': 50, 'width': 200, 'height': 360},
        ]

        old_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes), _clip_entry(NO_MODS_15, simple_crop_keyframes)]
        new_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes), _clip_entry(NO_MODS_15, distinguishing_crop)]
        old_snapshot = _snapshot(2, video_dims, old_clips, transition={'type': 'cut', 'duration': 0.0})
        new_snapshot = _snapshot(2, video_dims, new_clips, transition={'type': 'cut', 'duration': 0.0})

        on_boundary = _region('boundary-1', 15.0, 16.0, kf_time=15.0, x=540, y=960)

        result, dropped = _transform_multi_clip([on_boundary], old_snapshot, new_snapshot)

        assert dropped == 0
        assert len(result) == 1
        # Ground truth via the SAME production functions the transform uses
        # (never a hardcoded magic number): attribute to clip 1 -> to_raw with
        # clip 1's OLD crop (identical to clip 0's, so this step is a no-op)
        # -> to_working with clip 1's NEW (distinguishing) crop.
        local_region = _region('boundary-1', 0.0, 1.0, kf_time=0.0, x=540, y=960)
        old_canon = canonicalize_segments_data(NO_MODS_15, 15.0)
        raw_regions = transform_all_regions_to_raw(
            [local_region], simple_crop_keyframes, old_canon, video_dims, 30.0
        )
        expected_working = transform_all_regions_to_working(
            raw_regions, distinguishing_crop, old_canon, video_dims, 30.0
        )
        assert len(expected_working) == 1
        new_off_1 = get_output_duration(NO_MODS_15, 15.0)  # clip 0 unaffected -> off_1 still 15.0

        assert result[0]['start_time'] == pytest.approx(new_off_1 + expected_working[0]['start_time'], abs=0.05)
        assert result[0]['keyframes'][0]['x'] == pytest.approx(expected_working[0]['keyframes'][0]['x'], abs=0.5)
        # If it had wrongly attributed to clip 0 (crop unchanged there), the
        # keyframe x would round-trip back to the original 540 -- it must not.
        assert result[0]['keyframes'][0]['x'] != pytest.approx(540, abs=0.5)


# =============================================================================
# Dissolve: WITH transition key -> offsets subtract overlap correctly.
# Dissolve LEGACY (no transition key) -> multiclip_reset (loud), never a
# silent mis-map.
# =============================================================================


class TestDissolveTransition:
    def test_dissolve_with_transition_key_survives_and_transforms(self, video_dims, simple_crop_keyframes):
        """OLD snapshot HAS a 'transition': {'type': 'dissolve', 'duration': 0.5}
        key. 2 clips, no other framing change. off_1 = 15 - 0.5 = 14.5. A region
        inside clip 1 must survive at the correctly-offset time (not reset)."""
        old_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]
        new_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]
        old_snapshot = _snapshot(2, video_dims, old_clips, transition={'type': 'dissolve', 'duration': 0.5})
        new_snapshot = _snapshot(2, video_dims, new_clips, transition={'type': 'dissolve', 'duration': 0.5})

        # OLD off_1 = 14.5. Region global 16.5 -> local clip-1 time 2.0.
        region = _region('r1', 16.5, 17.5, kf_time=16.5)

        result, note = resolve_carried_highlights(
            prior_highlights=[region],
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=[{'id': 'detected-sentinel'}],
            clip_count=2,
        )

        assert note != NOTE_MULTICLIP_RESET
        assert len(result) == 1
        # No framing change -> NEW off_1 also 14.5, local geometry unchanged ->
        # global time round-trips back to 16.5.
        assert result[0]['start_time'] == pytest.approx(16.5, abs=0.05)

    def test_dissolve_legacy_snapshot_without_transition_key_resets_loudly(
        self, video_dims, simple_crop_keyframes, detected_regions_sentinel
    ):
        """OLD snapshot is a LEGACY multi-clip snapshot with NO 'transition' key
        at all (pre-T4355 blob) and the true old transition was dissolve. We
        cannot safely derive OLD offsets -> must take the loud multiclip_reset
        fallback, never guess and silently mis-place regions."""
        old_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]
        new_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]
        # Legacy OLD blob: literally no 'transition' key (simulates pre-T4355 data).
        old_snapshot = {'clip_count': 2, 'video_dims': video_dims, 'clips': old_clips}
        new_snapshot = _snapshot(2, video_dims, new_clips, transition={'type': 'dissolve', 'duration': 0.5})

        region = _region('r1', 16.5, 17.5, kf_time=16.5)

        result, note = resolve_carried_highlights(
            prior_highlights=[region],
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=detected_regions_sentinel,
            clip_count=2,
        )

        assert result == detected_regions_sentinel
        assert note == NOTE_MULTICLIP_RESET

    def test_legacy_snapshot_without_transition_key_transforms_fine_on_cut_reexport(
        self, video_dims, simple_crop_keyframes
    ):
        """OLD snapshot is a LEGACY multi-clip snapshot with NO 'transition' key
        (pre-T4355 blob), but the CURRENT (NEW) export is a plain 'cut'. Decision
        2: absent-key => treated as cut, which is exactly right here since a cut
        needs no overlap info -- this must TRANSFORM, not reset. A guard keyed
        only on "OLD snapshot lacks transition" (ignoring the NEW side) would
        wrongly reset every legacy multi-clip project on its very next cut
        re-export, discarding real user highlights the design says to preserve."""
        old_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]
        new_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]
        # Legacy OLD blob: literally no 'transition' key.
        old_snapshot = {'clip_count': 2, 'video_dims': video_dims, 'clips': old_clips}
        new_snapshot = _snapshot(2, video_dims, new_clips, transition={'type': 'cut', 'duration': 0.0})

        region = _region('r1', 16.5, 17.5, kf_time=16.5)

        result, note = resolve_carried_highlights(
            prior_highlights=[region],
            prior_snapshot=old_snapshot,
            new_snapshot=new_snapshot,
            detected_regions=[{'id': 'detected-sentinel'}],
            clip_count=2,
        )

        assert note != NOTE_MULTICLIP_RESET
        assert len(result) == 1
        assert result[0]['id'] == 'r1'
        # No framing change -> off_1 stays 15.0 on both sides -> round-trips to 16.5.
        assert result[0]['start_time'] == pytest.approx(16.5, abs=0.05)

    # Legacy-old + dissolve-new (the genuinely-unmappable residual, reset is
    # correct) is covered by test_dissolve_legacy_snapshot_without_transition_key_resets_loudly
    # above -- the guard fix is about NOT extending that reset to legacy-old +
    # cut-new (this class's preceding test), which the fixed guard now covers.


# =============================================================================
# Disabled region: carried untransformed via id-merge, NOT counted in dropped.
# =============================================================================


class TestDisabledRegion:
    def test_disabled_region_carried_untransformed_not_counted_in_dropped(self, video_dims, simple_crop_keyframes):
        """A disabled region on a clip that WOULD otherwise drop (e.g. removed
        clip) is carried through untransformed by id-merge and must NOT be
        counted in the dropped total (matches the single-clip contract)."""
        old_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(3)]
        new_clips = [_clip_entry(NO_MODS_15, simple_crop_keyframes) for _ in range(2)]  # clip 2 removed
        old_snapshot = _snapshot(3, video_dims, old_clips, transition={'type': 'cut', 'duration': 0.0})
        new_snapshot = _snapshot(2, video_dims, new_clips, transition={'type': 'cut', 'duration': 0.0})

        # disabled region attributed to removed clip 2 (OLD span [30,45))
        disabled_on_removed_clip = _region('disabled-1', 32.0, 34.0, kf_time=32.0, enabled=False)
        # enabled surviving region on clip 0
        surviving = _region('surv-1', 2.0, 4.0, kf_time=2.0)

        result, dropped = _transform_multi_clip(
            [disabled_on_removed_clip, surviving], old_snapshot, new_snapshot
        )

        result_ids = {r['id'] for r in result}
        assert 'disabled-1' in result_ids  # carried, not dropped
        assert 'surv-1' in result_ids
        assert dropped == 0  # disabled region never counted


# =============================================================================
# Finalize round-trip: extend test_t4350_carry_finalize.py, not a new file.
# See the amended assertions appended to that module below (added in this
# same commit).
# =============================================================================
