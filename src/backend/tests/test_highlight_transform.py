"""
Tests for highlight_transform.py

These tests validate the coordinate and time transformation functions
that convert between working video space and raw clip space.

CRITICAL: All tests must pass before integrating with the application.
"""

import pytest
from app.highlight_transform import (
    # Time mapping
    get_trim_range,
    get_segment_speed,
    get_segment_at_source_time,
    working_time_to_source_time,
    source_time_to_working_time,
    working_time_to_raw_frame,
    raw_frame_to_working_time,
    # Coordinate mapping
    interpolate_crop_at_frame,
    working_coords_to_raw_coords,
    raw_coords_to_working_coords,
    # High-level transforms
    transform_keyframe_to_raw,
    transform_keyframe_to_working,
    transform_highlight_region_to_raw,
    transform_highlight_region_to_working,
    transform_all_regions_to_raw,
    transform_all_regions_to_working,
)


# =============================================================================
# TEST FIXTURES
# =============================================================================

@pytest.fixture
def no_modifications_segments():
    """Segments data with no modifications (no trim, no speed changes)"""
    return {
        'boundaries': [0.0, 15.0],
        'segmentSpeeds': {},
        'trimRange': None
    }


@pytest.fixture
def trim_only_segments():
    """Segments data with trim only (no speed changes)"""
    return {
        'boundaries': [0.0, 15.0],
        'segmentSpeeds': {},
        'trimRange': {'start': 2.0, 'end': 12.0}
    }


@pytest.fixture
def speed_only_segments():
    """Segments data with speed changes only (no trim)"""
    return {
        'boundaries': [0.0, 5.0, 10.0, 15.0],
        'segmentSpeeds': {'1': 0.5},  # Middle segment at half speed
        'trimRange': None
    }


@pytest.fixture
def complex_segments():
    """Segments data with both trim and speed changes"""
    return {
        'boundaries': [0.0, 5.0, 10.0, 15.0],
        'segmentSpeeds': {'1': 0.5},  # Segment 1 (5-10s) at half speed
        'trimRange': {'start': 2.0, 'end': 13.0}
    }


@pytest.fixture
def simple_crop_keyframes():
    """Simple crop keyframes (constant crop throughout)"""
    return [
        {'frame': 0, 'x': 100, 'y': 50, 'width': 200, 'height': 360},
        {'frame': 450, 'x': 100, 'y': 50, 'width': 200, 'height': 360}  # 15s @ 30fps
    ]


@pytest.fixture
def animated_crop_keyframes():
    """Animated crop keyframes (crop moves)"""
    return [
        {'frame': 0, 'x': 100, 'y': 50, 'width': 200, 'height': 360},
        {'frame': 150, 'x': 150, 'y': 80, 'width': 200, 'height': 360},  # 5s
        {'frame': 450, 'x': 100, 'y': 50, 'width': 200, 'height': 360}   # 15s
    ]


@pytest.fixture
def working_video_9x16():
    """9:16 aspect ratio working video (Reels)"""
    return {'width': 1080, 'height': 1920}


@pytest.fixture
def working_video_16x9():
    """16:9 aspect ratio working video (YouTube)"""
    return {'width': 1920, 'height': 1080}


# =============================================================================
# TIME MAPPING TESTS
# =============================================================================

class TestGetTrimRange:
    """Tests for get_trim_range helper"""

    def test_none_segments(self):
        start, end = get_trim_range(None)
        assert start == 0.0
        assert end == float('inf')

    def test_no_trim(self, no_modifications_segments):
        start, end = get_trim_range(no_modifications_segments)
        assert start == 0.0
        assert end == float('inf')

    def test_with_trim_dict(self, trim_only_segments):
        start, end = get_trim_range(trim_only_segments)
        assert start == 2.0
        assert end == 12.0

    def test_with_trim_list(self):
        segments = {'trimRange': [3.0, 10.0]}
        start, end = get_trim_range(segments)
        assert start == 3.0
        assert end == 10.0


class TestGetSegmentSpeed:
    """Tests for get_segment_speed helper"""

    def test_none_segments(self):
        assert get_segment_speed(None, 0) == 1.0

    def test_default_speed(self, no_modifications_segments):
        assert get_segment_speed(no_modifications_segments, 0) == 1.0
        assert get_segment_speed(no_modifications_segments, 1) == 1.0

    def test_custom_speed(self, speed_only_segments):
        assert get_segment_speed(speed_only_segments, 0) == 1.0
        assert get_segment_speed(speed_only_segments, 1) == 0.5
        assert get_segment_speed(speed_only_segments, 2) == 1.0


class TestWorkingTimeToSourceTime:
    """Tests for working_time_to_source_time"""

    def test_no_modifications(self, no_modifications_segments):
        """Without modifications, times should map 1:1"""
        assert working_time_to_source_time(0.0, no_modifications_segments) == 0.0
        assert working_time_to_source_time(5.0, no_modifications_segments) == 5.0
        assert working_time_to_source_time(10.0, no_modifications_segments) == 10.0

    def test_trim_only(self, trim_only_segments):
        """With trim, working time 0 = trim start in source"""
        # Trim is 2-12, so working_time 0 = source_time 2
        assert working_time_to_source_time(0.0, trim_only_segments) == 2.0
        assert working_time_to_source_time(5.0, trim_only_segments) == 7.0
        assert working_time_to_source_time(10.0, trim_only_segments) == 12.0

    def test_speed_half(self, speed_only_segments):
        """With segment at 0.5x speed, visual time is longer than source time"""
        # Segment 0: 0-5s @ 1.0x -> 5s visual
        # Segment 1: 5-10s @ 0.5x -> 10s visual (5 source seconds / 0.5 = 10 visual)
        # Segment 2: 10-15s @ 1.0x -> 5s visual

        # At working_time 0, we're at source_time 0
        assert working_time_to_source_time(0.0, speed_only_segments) == 0.0

        # At working_time 5, we've passed segment 0 (5s visual = 5s source)
        assert working_time_to_source_time(5.0, speed_only_segments) == 5.0

        # At working_time 10, we're 5 visual seconds into segment 1
        # 5 visual seconds at 0.5x speed = 2.5 source seconds
        assert working_time_to_source_time(10.0, speed_only_segments) == pytest.approx(7.5)

        # At working_time 15, we've finished segment 1
        # Segment 1: 5s source / 0.5 = 10s visual, so total 5+10=15s visual = 10s source
        assert working_time_to_source_time(15.0, speed_only_segments) == 10.0


class TestSourceTimeToWorkingTime:
    """Tests for source_time_to_working_time"""

    def test_no_modifications(self, no_modifications_segments):
        """Without modifications, times should map 1:1"""
        assert source_time_to_working_time(0.0, no_modifications_segments) == 0.0
        assert source_time_to_working_time(5.0, no_modifications_segments) == 5.0
        assert source_time_to_working_time(10.0, no_modifications_segments) == 10.0

    def test_trim_only(self, trim_only_segments):
        """With trim, source time before trim returns None"""
        # Trim is 2-12
        assert source_time_to_working_time(1.0, trim_only_segments) is None  # Before trim
        assert source_time_to_working_time(2.0, trim_only_segments) == 0.0   # At trim start
        assert source_time_to_working_time(7.0, trim_only_segments) == 5.0   # Middle
        assert source_time_to_working_time(12.0, trim_only_segments) == 10.0 # At trim end
        assert source_time_to_working_time(13.0, trim_only_segments) is None # After trim

    def test_speed_half(self, speed_only_segments):
        """With segment at 0.5x speed"""
        # Segment 0: 0-5s @ 1.0x
        # Segment 1: 5-10s @ 0.5x (5s source -> 10s visual)
        # Segment 2: 10-15s @ 1.0x

        assert source_time_to_working_time(0.0, speed_only_segments) == 0.0
        assert source_time_to_working_time(5.0, speed_only_segments) == 5.0

        # source_time 7.5 is 2.5s into segment 1
        # 2.5s source / 0.5 = 5s visual into segment 1
        # Total: 5 + 5 = 10s working time
        assert source_time_to_working_time(7.5, speed_only_segments) == pytest.approx(10.0)

        # source_time 10 is end of segment 1
        # 5s source segment / 0.5 = 10s visual
        # Total: 5 + 10 = 15s working time
        assert source_time_to_working_time(10.0, speed_only_segments) == pytest.approx(15.0)


class TestTimeRoundtrip:
    """Tests for bidirectional time conversions"""

    def test_roundtrip_no_modifications(self, no_modifications_segments):
        """working -> source -> working returns original"""
        for t in [0.0, 2.5, 5.0, 7.5, 10.0, 12.5]:
            source_t = working_time_to_source_time(t, no_modifications_segments)
            back = source_time_to_working_time(source_t, no_modifications_segments)
            assert back == pytest.approx(t, abs=0.001)

    def test_roundtrip_trim_only(self, trim_only_segments):
        """working -> source -> working returns original (trim case)"""
        # Visible range is 0-10 working time
        for t in [0.0, 2.5, 5.0, 7.5, 10.0]:
            source_t = working_time_to_source_time(t, trim_only_segments)
            back = source_time_to_working_time(source_t, trim_only_segments)
            assert back == pytest.approx(t, abs=0.001)

    def test_roundtrip_speed_changes(self, speed_only_segments):
        """working -> source -> working returns original (speed case)"""
        for t in [0.0, 2.5, 5.0, 7.5, 10.0, 12.5, 15.0]:
            source_t = working_time_to_source_time(t, speed_only_segments)
            back = source_time_to_working_time(source_t, speed_only_segments)
            assert back == pytest.approx(t, abs=0.001)


class TestWorkingTimeToRawFrame:
    """Tests for working_time_to_raw_frame"""

    def test_simple_conversion(self, no_modifications_segments):
        """Basic time to frame conversion at 30fps"""
        assert working_time_to_raw_frame(0.0, no_modifications_segments, 30.0) == 0
        assert working_time_to_raw_frame(1.0, no_modifications_segments, 30.0) == 30
        assert working_time_to_raw_frame(5.0, no_modifications_segments, 30.0) == 150

    def test_with_trim(self, trim_only_segments):
        """Trim shifts frame numbers"""
        # Trim starts at 2s, so working_time 0 = frame 60
        assert working_time_to_raw_frame(0.0, trim_only_segments, 30.0) == 60
        assert working_time_to_raw_frame(5.0, trim_only_segments, 30.0) == 210  # 7s @ 30fps

    def test_negative_time_returns_none(self, no_modifications_segments):
        """Negative time returns None"""
        assert working_time_to_raw_frame(-1.0, no_modifications_segments, 30.0) is None


class TestRawFrameToWorkingTime:
    """Tests for raw_frame_to_working_time"""

    def test_simple_conversion(self, no_modifications_segments):
        """Basic frame to time conversion at 30fps"""
        assert raw_frame_to_working_time(0, no_modifications_segments, 30.0) == 0.0
        assert raw_frame_to_working_time(30, no_modifications_segments, 30.0) == 1.0
        assert raw_frame_to_working_time(150, no_modifications_segments, 30.0) == 5.0

    def test_with_trim(self, trim_only_segments):
        """Frame in trimmed region returns None"""
        # Trim is 2-12s (frames 60-360)
        assert raw_frame_to_working_time(30, trim_only_segments, 30.0) is None  # Before trim
        assert raw_frame_to_working_time(60, trim_only_segments, 30.0) == 0.0   # At trim start
        assert raw_frame_to_working_time(400, trim_only_segments, 30.0) is None # After trim


class TestFrameRoundtrip:
    """Tests for bidirectional frame conversions"""

    def test_roundtrip(self, no_modifications_segments):
        """working_time -> raw_frame -> working_time returns original"""
        for t in [0.0, 1.0, 2.5, 5.0, 10.0]:
            frame = working_time_to_raw_frame(t, no_modifications_segments, 30.0)
            back = raw_frame_to_working_time(frame, no_modifications_segments, 30.0)
            # Allow for frame rounding
            assert abs(back - t) < 0.05


# =============================================================================
# COORDINATE MAPPING TESTS
# =============================================================================

class TestInterpolateCropAtFrame:
    """Tests for interpolate_crop_at_frame"""

    def test_empty_keyframes(self):
        """Empty keyframes returns None"""
        assert interpolate_crop_at_frame([], 0) is None

    def test_single_keyframe(self, simple_crop_keyframes):
        """Before first keyframe returns first keyframe values"""
        crop = interpolate_crop_at_frame(simple_crop_keyframes, 0)
        assert crop['x'] == 100
        assert crop['y'] == 50
        assert crop['width'] == 200
        assert crop['height'] == 360

    def test_after_last_keyframe(self, simple_crop_keyframes):
        """After last keyframe returns last keyframe values"""
        crop = interpolate_crop_at_frame(simple_crop_keyframes, 500)
        assert crop['x'] == 100

    def test_interpolation(self, animated_crop_keyframes):
        """Values are interpolated between keyframes"""
        # At frame 75 (halfway between 0 and 150)
        crop = interpolate_crop_at_frame(animated_crop_keyframes, 75)
        assert crop['x'] == pytest.approx(125)  # Halfway between 100 and 150
        assert crop['y'] == pytest.approx(65)   # Halfway between 50 and 80


class TestWorkingCoordsToRawCoords:
    """Tests for working_coords_to_raw_coords"""

    def test_center_point(self):
        """Center of working video maps to center of crop"""
        crop = {'x': 100, 'y': 50, 'width': 200, 'height': 400}
        working_dims = {'width': 1080, 'height': 1920}

        # Center of working video
        result = working_coords_to_raw_coords(
            working_x=540, working_y=960,  # Center of 1080x1920
            working_radiusX=50, working_radiusY=100,
            crop=crop,
            working_video_dims=working_dims
        )

        # Should map to center of crop region
        assert result['x'] == pytest.approx(200)  # 100 + (540/1080)*200 = 100 + 100
        assert result['y'] == pytest.approx(250)  # 50 + (960/1920)*400 = 50 + 200

    def test_corner_points(self):
        """Corner points map correctly"""
        crop = {'x': 100, 'y': 50, 'width': 200, 'height': 400}
        working_dims = {'width': 1000, 'height': 2000}

        # Top-left corner (0, 0) should map to crop origin
        result = working_coords_to_raw_coords(
            working_x=0, working_y=0,
            working_radiusX=10, working_radiusY=20,
            crop=crop,
            working_video_dims=working_dims
        )
        assert result['x'] == pytest.approx(100)
        assert result['y'] == pytest.approx(50)

        # Bottom-right corner should map to crop end
        result = working_coords_to_raw_coords(
            working_x=1000, working_y=2000,
            working_radiusX=10, working_radiusY=20,
            crop=crop,
            working_video_dims=working_dims
        )
        assert result['x'] == pytest.approx(300)  # 100 + 200
        assert result['y'] == pytest.approx(450)  # 50 + 400

    def test_size_scaling(self):
        """Sizes scale proportionally to crop"""
        crop = {'x': 0, 'y': 0, 'width': 500, 'height': 500}
        working_dims = {'width': 1000, 'height': 1000}

        # Crop is half the working video size, so raw sizes should be half
        result = working_coords_to_raw_coords(
            working_x=500, working_y=500,
            working_radiusX=100, working_radiusY=200,
            crop=crop,
            working_video_dims=working_dims
        )
        assert result['radiusX'] == pytest.approx(50)   # 100 * (500/1000)
        assert result['radiusY'] == pytest.approx(100)  # 200 * (500/1000)


class TestRawCoordsToWorkingCoords:
    """Tests for raw_coords_to_working_coords"""

    def test_center_point(self):
        """Center of crop maps to center of working video"""
        crop = {'x': 100, 'y': 50, 'width': 200, 'height': 400}
        working_dims = {'width': 1080, 'height': 1920}

        # Center of crop region
        result = raw_coords_to_working_coords(
            raw_x=200, raw_y=250,  # Center of crop
            raw_radiusX=20, raw_radiusY=40,
            crop=crop,
            working_video_dims=working_dims
        )

        assert result['x'] == pytest.approx(540)   # Center of 1080
        assert result['y'] == pytest.approx(960)   # Center of 1920
        assert result['visible'] is True

    def test_point_outside_crop(self):
        """Point outside crop is marked not visible"""
        crop = {'x': 100, 'y': 50, 'width': 200, 'height': 400}
        working_dims = {'width': 1080, 'height': 1920}

        # Point before crop region
        result = raw_coords_to_working_coords(
            raw_x=50, raw_y=25,  # Before crop start
            raw_radiusX=20, raw_radiusY=40,
            crop=crop,
            working_video_dims=working_dims
        )

        assert result['visible'] is False


class TestCoordinateRoundtrip:
    """Tests for bidirectional coordinate conversions"""

    def test_roundtrip(self):
        """working -> raw -> working returns original"""
        crop = {'x': 100, 'y': 50, 'width': 200, 'height': 400}
        working_dims = {'width': 1080, 'height': 1920}

        original = {
            'x': 540, 'y': 960,
            'radiusX': 50, 'radiusY': 100
        }

        # Transform to raw
        raw = working_coords_to_raw_coords(
            original['x'], original['y'],
            original['radiusX'], original['radiusY'],
            crop, working_dims
        )

        # Transform back
        back = raw_coords_to_working_coords(
            raw['x'], raw['y'],
            raw['radiusX'], raw['radiusY'],
            crop, working_dims
        )

        assert back['x'] == pytest.approx(original['x'], rel=0.001)
        assert back['y'] == pytest.approx(original['y'], rel=0.001)
        assert back['radiusX'] == pytest.approx(original['radiusX'], rel=0.001)
        assert back['radiusY'] == pytest.approx(original['radiusY'], rel=0.001)
        assert back['visible'] is True


# =============================================================================
# HIGH-LEVEL TRANSFORM TESTS
# =============================================================================

class TestTransformKeyframeToRaw:
    """Tests for transform_keyframe_to_raw"""

    def test_simple_transform(
        self, no_modifications_segments, simple_crop_keyframes, working_video_9x16
    ):
        """Basic keyframe transformation"""
        keyframe = {
            'time': 2.0,
            'x': 540, 'y': 960,
            'radiusX': 50, 'radiusY': 100,
            'opacity': 0.15,
            'color': '#FFFF00'
        }

        result = transform_keyframe_to_raw(
            keyframe=keyframe,
            crop_keyframes=simple_crop_keyframes,
            segments_data=no_modifications_segments,
            working_video_dims=working_video_9x16,
            framerate=30.0
        )

        assert result is not None
        assert result['raw_frame'] == 60  # 2.0s @ 30fps
        assert result['opacity'] == 0.15
        assert result['color'] == '#FFFF00'


class TestTransformKeyframeToWorking:
    """Tests for transform_keyframe_to_working"""

    def test_simple_transform(
        self, no_modifications_segments, simple_crop_keyframes, working_video_9x16
    ):
        """Basic keyframe transformation"""
        raw_keyframe = {
            'raw_frame': 60,  # 2.0s @ 30fps
            'raw_x': 200, 'raw_y': 230,
            'raw_radiusX': 10, 'raw_radiusY': 20,
            'opacity': 0.15,
            'color': '#FFFF00'
        }

        result = transform_keyframe_to_working(
            raw_keyframe=raw_keyframe,
            crop_keyframes=simple_crop_keyframes,
            segments_data=no_modifications_segments,
            working_video_dims=working_video_9x16,
            framerate=30.0
        )

        assert result is not None
        assert result['time'] == pytest.approx(2.0, abs=0.05)
        assert result['opacity'] == 0.15
        assert result['color'] == '#FFFF00'


class TestTransformHighlightRegionToRaw:
    """Tests for transform_highlight_region_to_raw"""

    def test_simple_region(
        self, no_modifications_segments, simple_crop_keyframes, working_video_9x16
    ):
        """Transform a simple region with two keyframes"""
        region = {
            'id': 'test-region',
            'start_time': 2.0,
            'end_time': 5.0,
            'enabled': True,
            'keyframes': [
                {'time': 2.0, 'x': 540, 'y': 960, 'radiusX': 50, 'radiusY': 100},
                {'time': 4.0, 'x': 560, 'y': 940, 'radiusX': 50, 'radiusY': 100}
            ]
        }

        result = transform_highlight_region_to_raw(
            region=region,
            crop_keyframes=simple_crop_keyframes,
            segments_data=no_modifications_segments,
            working_video_dims=working_video_9x16,
            framerate=30.0
        )

        assert result is not None
        assert result['id'] == 'test-region'
        assert result['raw_start_frame'] == 60   # 2.0s @ 30fps
        assert result['raw_end_frame'] == 150    # 5.0s @ 30fps
        assert result['duration_seconds'] == 3.0
        assert len(result['keyframes']) == 2

    def test_disabled_region_returns_none(
        self, no_modifications_segments, simple_crop_keyframes, working_video_9x16
    ):
        """Disabled regions return None"""
        region = {
            'id': 'test-region',
            'start_time': 2.0,
            'end_time': 5.0,
            'enabled': False,
            'keyframes': []
        }

        result = transform_highlight_region_to_raw(
            region=region,
            crop_keyframes=simple_crop_keyframes,
            segments_data=no_modifications_segments,
            working_video_dims=working_video_9x16,
            framerate=30.0
        )

        assert result is None


class TestTransformHighlightRegionToWorking:
    """Tests for transform_highlight_region_to_working"""

    def test_simple_region(
        self, no_modifications_segments, simple_crop_keyframes, working_video_9x16
    ):
        """Transform a raw region to working video space"""
        raw_region = {
            'id': 'test-region',
            'raw_start_frame': 60,
            'raw_end_frame': 150,
            'duration_seconds': 3.0,
            'keyframes': [
                {'raw_frame': 60, 'raw_x': 200, 'raw_y': 230, 'raw_radiusX': 10, 'raw_radiusY': 20},
                {'raw_frame': 120, 'raw_x': 210, 'raw_y': 220, 'raw_radiusX': 10, 'raw_radiusY': 20}
            ]
        }

        result = transform_highlight_region_to_working(
            raw_region=raw_region,
            crop_keyframes=simple_crop_keyframes,
            segments_data=no_modifications_segments,
            working_video_dims=working_video_9x16,
            framerate=30.0
        )

        assert result is not None
        assert result['id'] == 'test-region'
        assert result['start_time'] == pytest.approx(2.0, abs=0.05)
        assert result['end_time'] == pytest.approx(5.0, abs=0.05)
        assert result['enabled'] is True
        assert len(result['keyframes']) == 2


class TestRegionRoundtrip:
    """Tests for bidirectional region transformations"""

    def test_roundtrip(
        self, no_modifications_segments, simple_crop_keyframes, working_video_9x16
    ):
        """working -> raw -> working returns approximately original"""
        original_region = {
            'id': 'test-region',
            'start_time': 2.0,
            'end_time': 5.0,
            'enabled': True,
            'keyframes': [
                {'time': 2.0, 'x': 540, 'y': 960, 'radiusX': 50, 'radiusY': 100, 'opacity': 0.15, 'color': '#FFFF00'},
                {'time': 4.0, 'x': 560, 'y': 940, 'radiusX': 50, 'radiusY': 100, 'opacity': 0.15, 'color': '#FFFF00'}
            ]
        }

        # Transform to raw
        raw_region = transform_highlight_region_to_raw(
            region=original_region,
            crop_keyframes=simple_crop_keyframes,
            segments_data=no_modifications_segments,
            working_video_dims=working_video_9x16,
            framerate=30.0
        )

        # Transform back
        back_region = transform_highlight_region_to_working(
            raw_region=raw_region,
            crop_keyframes=simple_crop_keyframes,
            segments_data=no_modifications_segments,
            working_video_dims=working_video_9x16,
            framerate=30.0
        )

        assert back_region is not None
        assert back_region['start_time'] == pytest.approx(original_region['start_time'], abs=0.1)
        assert back_region['end_time'] == pytest.approx(original_region['end_time'], abs=0.1)
        assert len(back_region['keyframes']) == len(original_region['keyframes'])

        # Check first keyframe position
        orig_kf = original_region['keyframes'][0]
        back_kf = back_region['keyframes'][0]
        assert back_kf['x'] == pytest.approx(orig_kf['x'], rel=0.01)
        assert back_kf['y'] == pytest.approx(orig_kf['y'], rel=0.01)


# =============================================================================
# ASPECT RATIO CHANGE TESTS (Critical for 9:16 <-> 16:9)
# =============================================================================

class TestAspectRatioChanges:
    """Tests for transformations between different aspect ratios"""

    def test_9x16_to_16x9_center_visible(self, no_modifications_segments):
        """Player at center of 9:16 should be visible in 16:9"""
        # 9:16 crop (portrait)
        crop_9x16 = [{'frame': 0, 'x': 200, 'y': 0, 'width': 200, 'height': 360}]
        working_9x16 = {'width': 1080, 'height': 1920}

        # 16:9 crop (landscape) - different region of same raw clip
        crop_16x9 = [{'frame': 0, 'x': 0, 'y': 50, 'width': 640, 'height': 360}]
        working_16x9 = {'width': 1920, 'height': 1080}

        # Create highlight at center of 9:16 working video
        region_9x16 = {
            'id': 'test',
            'start_time': 1.0,
            'end_time': 3.0,
            'enabled': True,
            'keyframes': [
                {'time': 1.0, 'x': 540, 'y': 960, 'radiusX': 50, 'radiusY': 100}
            ]
        }

        # Transform to raw
        raw_region = transform_highlight_region_to_raw(
            region=region_9x16,
            crop_keyframes=crop_9x16,
            segments_data=no_modifications_segments,
            working_video_dims=working_9x16,
            framerate=30.0
        )

        assert raw_region is not None

        # Transform to 16:9
        region_16x9 = transform_highlight_region_to_working(
            raw_region=raw_region,
            crop_keyframes=crop_16x9,
            segments_data=no_modifications_segments,
            working_video_dims=working_16x9,
            framerate=30.0
        )

        # Player should be visible (if raw coords fall within 16:9 crop)
        # The 9:16 crop is at x=200-400, the 16:9 crop is at x=0-640
        # So the center (x=300 raw) should be visible in 16:9
        if region_16x9 is not None:
            assert len(region_16x9['keyframes']) > 0

    def test_player_outside_new_crop_not_visible(self, no_modifications_segments):
        """Player outside new crop area should not create keyframe"""
        # 9:16 crop on left side
        crop_9x16 = [{'frame': 0, 'x': 0, 'y': 0, 'width': 200, 'height': 360}]
        working_9x16 = {'width': 1080, 'height': 1920}

        # 16:9 crop on right side (no overlap)
        crop_16x9 = [{'frame': 0, 'x': 400, 'y': 0, 'width': 640, 'height': 360}]
        working_16x9 = {'width': 1920, 'height': 1080}

        # Create highlight at center of 9:16 (which is x=100 in raw)
        region_9x16 = {
            'id': 'test',
            'start_time': 1.0,
            'end_time': 3.0,
            'enabled': True,
            'keyframes': [
                {'time': 1.0, 'x': 540, 'y': 960, 'radiusX': 50, 'radiusY': 100}
            ]
        }

        # Transform to raw
        raw_region = transform_highlight_region_to_raw(
            region=region_9x16,
            crop_keyframes=crop_9x16,
            segments_data=no_modifications_segments,
            working_video_dims=working_9x16,
            framerate=30.0
        )

        # Transform to 16:9 - should return None or empty keyframes
        region_16x9 = transform_highlight_region_to_working(
            raw_region=raw_region,
            crop_keyframes=crop_16x9,
            segments_data=no_modifications_segments,
            working_video_dims=working_16x9,
            framerate=30.0
        )

        # Region should be None because all keyframes are outside visible area
        assert region_16x9 is None


# =============================================================================
# COMPLEX SCENARIO TESTS
# =============================================================================

class TestComplexScenarios:
    """Tests for complex real-world scenarios"""

    def test_trim_and_speed_combined(self, complex_segments, simple_crop_keyframes, working_video_9x16):
        """Highlight with both trim and speed changes"""
        # complex_segments: trim 2-13, segment 1 (5-10) at 0.5x

        region = {
            'id': 'test',
            'start_time': 0.0,  # This is at source_time 2.0 (trim start)
            'end_time': 3.0,    # 3s of working time
            'enabled': True,
            'keyframes': [
                {'time': 0.0, 'x': 540, 'y': 960, 'radiusX': 50, 'radiusY': 100}
            ]
        }

        raw_region = transform_highlight_region_to_raw(
            region=region,
            crop_keyframes=simple_crop_keyframes,
            segments_data=complex_segments,
            working_video_dims=working_video_9x16,
            framerate=30.0
        )

        assert raw_region is not None
        # At working_time 0, we should be at source_time 2.0 (trim start)
        assert raw_region['raw_start_frame'] == 60  # 2.0s @ 30fps

    def test_multiple_regions(self, no_modifications_segments, simple_crop_keyframes, working_video_9x16):
        """Multiple regions transform correctly"""
        regions = [
            {
                'id': 'region-1',
                'start_time': 1.0,
                'end_time': 3.0,
                'enabled': True,
                'keyframes': [{'time': 1.0, 'x': 540, 'y': 960, 'radiusX': 50, 'radiusY': 100}]
            },
            {
                'id': 'region-2',
                'start_time': 5.0,
                'end_time': 7.0,
                'enabled': True,
                'keyframes': [{'time': 5.0, 'x': 600, 'y': 800, 'radiusX': 40, 'radiusY': 80}]
            }
        ]

        raw_regions = transform_all_regions_to_raw(
            regions=regions,
            crop_keyframes=simple_crop_keyframes,
            segments_data=no_modifications_segments,
            working_video_dims=working_video_9x16,
            framerate=30.0
        )

        assert len(raw_regions) == 2
        assert raw_regions[0]['id'] == 'region-1'
        assert raw_regions[1]['id'] == 'region-2'
