"""
Tests for JSON schema models.

These tests verify that the Pydantic models correctly parse and serialize
the JSON data stored in database columns.
"""

import json
import pytest
from app.schemas import (
    # Crop models
    CropKeyframe, CropData,
    # Timing models
    TimingData,
    # Segments models
    SegmentsData,
    # Highlights models
    HighlightKeyframe, HighlightRegion, HighlightsData,
    # Text overlay models
    TextOverlay, TextOverlaysData,
    # Helper functions
    parse_crop_data, parse_timing_data, parse_segments_data, parse_highlights_data,
)


class TestCropKeyframe:
    """Test CropKeyframe model."""

    def test_create_keyframe(self):
        """Can create a crop keyframe with required fields."""
        kf = CropKeyframe(frame=0, x=100, y=50, width=640, height=360)
        assert kf.frame == 0
        assert kf.x == 100
        assert kf.y == 50
        assert kf.width == 640
        assert kf.height == 360
        assert kf.origin == 'user'  # Default

    def test_origin_values(self):
        """Origin can be permanent, user, or trim."""
        kf1 = CropKeyframe(frame=0, x=0, y=0, width=100, height=100, origin='permanent')
        kf2 = CropKeyframe(frame=10, x=0, y=0, width=100, height=100, origin='user')
        kf3 = CropKeyframe(frame=20, x=0, y=0, width=100, height=100, origin='trim')

        assert kf1.origin == 'permanent'
        assert kf2.origin == 'user'
        assert kf3.origin == 'trim'

    def test_invalid_origin_rejected(self):
        """Invalid origin values are rejected."""
        with pytest.raises(ValueError):
            CropKeyframe(frame=0, x=0, y=0, width=100, height=100, origin='invalid')


class TestCropData:
    """Test CropData model."""

    def test_empty_crop_data(self):
        """Can create empty crop data."""
        data = CropData()
        assert data.keyframes == []

    def test_from_json_list(self):
        """Can parse from raw JSON list format."""
        json_list = [
            {"frame": 0, "x": 100, "y": 50, "width": 640, "height": 360, "origin": "permanent"},
            {"frame": 300, "x": 200, "y": 100, "width": 640, "height": 360, "origin": "permanent"}
        ]
        data = CropData.from_json_list(json_list)

        assert len(data.keyframes) == 2
        assert data.keyframes[0].frame == 0
        assert data.keyframes[0].origin == 'permanent'
        assert data.keyframes[1].frame == 300

    def test_to_json_list(self):
        """Can serialize to raw JSON list format."""
        data = CropData(keyframes=[
            CropKeyframe(frame=0, x=100, y=50, width=640, height=360, origin='permanent'),
            CropKeyframe(frame=300, x=200, y=100, width=640, height=360, origin='user')
        ])

        json_list = data.to_json_list()
        assert len(json_list) == 2
        assert json_list[0]['frame'] == 0
        assert json_list[0]['origin'] == 'permanent'

    def test_round_trip(self):
        """JSON list -> CropData -> JSON list preserves data."""
        original = [
            {"frame": 0, "x": 100.5, "y": 50.5, "width": 640, "height": 360, "origin": "permanent"},
            {"frame": 150, "x": 150, "y": 75, "width": 640, "height": 360, "origin": "user"}
        ]

        data = CropData.from_json_list(original)
        result = data.to_json_list()

        assert result[0]['frame'] == original[0]['frame']
        assert result[0]['x'] == original[0]['x']
        assert result[1]['origin'] == original[1]['origin']


class TestTimingData:
    """Test TimingData model."""

    def test_no_trim(self):
        """Can create timing data with no trim."""
        data = TimingData()
        assert data.trimRange is None

    def test_with_trim_range(self):
        """Can create timing data with trim range."""
        data = TimingData(trimRange=(2.5, 10.0))
        assert data.trimRange == (2.5, 10.0)

    def test_trim_range_from_list(self):
        """Trim range can be parsed from list format."""
        data = TimingData(trimRange=[2.5, 10.0])  # List instead of tuple
        assert data.trimRange == (2.5, 10.0)

    def test_from_json(self):
        """Can parse from JSON."""
        json_str = '{"trimRange": [1.5, 8.5]}'
        data = TimingData.model_validate_json(json_str)
        assert data.trimRange == (1.5, 8.5)


class TestSegmentsData:
    """Test SegmentsData model."""

    def test_default_segments(self):
        """Default segments have minimal boundaries."""
        data = SegmentsData()
        assert data.boundaries == [0.0]
        assert data.userSplits == []
        assert data.trimRange is None
        assert data.segmentSpeeds == {}

    def test_full_segments_data(self):
        """Can create segments data with all fields."""
        data = SegmentsData(
            boundaries=[0.0, 5.0, 10.0, 15.0],
            userSplits=[5.0, 10.0],
            trimRange=(2.0, 12.0),
            segmentSpeeds={"0": 1.0, "1": 0.5, "2": 2.0}
        )

        assert len(data.boundaries) == 4
        assert len(data.userSplits) == 2
        assert data.trimRange == (2.0, 12.0)
        assert data.get_segment_speed(0) == 1.0
        assert data.get_segment_speed(1) == 0.5
        assert data.get_segment_speed(2) == 2.0

    def test_get_segment_speed_default(self):
        """Missing segment speed defaults to 1.0."""
        data = SegmentsData(segmentSpeeds={"0": 0.5})
        assert data.get_segment_speed(0) == 0.5
        assert data.get_segment_speed(1) == 1.0  # Not set, defaults to 1.0
        assert data.get_segment_speed(99) == 1.0

    def test_from_json(self):
        """Can parse from JSON."""
        json_str = '''
        {
            "boundaries": [0, 5.5, 11],
            "userSplits": [5.5],
            "trimRange": [1, 10],
            "segmentSpeeds": {"0": 1.0, "1": 0.5}
        }
        '''
        data = SegmentsData.model_validate_json(json_str)
        assert data.boundaries == [0, 5.5, 11]
        assert data.trimRange == (1.0, 10.0)


class TestHighlightKeyframe:
    """Test HighlightKeyframe model."""

    def test_create_with_time(self):
        """Can create highlight keyframe with time."""
        kf = HighlightKeyframe(
            time=2.5,
            x=500, y=300,
            radiusX=30, radiusY=50
        )
        assert kf.time == 2.5
        assert kf.frame is None
        assert kf.x == 500
        assert kf.opacity == 0.15  # Default
        assert kf.color == '#FFFF00'  # Default

    def test_create_with_frame(self):
        """Can create highlight keyframe with frame."""
        kf = HighlightKeyframe(
            frame=75,
            x=500, y=300,
            radiusX=30, radiusY=50
        )
        assert kf.frame == 75
        assert kf.time is None

    def test_custom_appearance(self):
        """Can set custom opacity and color."""
        kf = HighlightKeyframe(
            time=1.0,
            x=100, y=100,
            radiusX=20, radiusY=40,
            opacity=0.5,
            color='#FF0000'
        )
        assert kf.opacity == 0.5
        assert kf.color == '#FF0000'

    def test_opacity_bounds(self):
        """Opacity must be between 0 and 1."""
        with pytest.raises(ValueError):
            HighlightKeyframe(
                time=1.0, x=100, y=100,
                radiusX=20, radiusY=40,
                opacity=1.5  # Invalid
            )


class TestHighlightRegion:
    """Test HighlightRegion model."""

    def test_create_region_snake_case(self):
        """Can create region with snake_case times."""
        region = HighlightRegion(
            id='region-1',
            start_time=0.0,
            end_time=5.0,
            keyframes=[]
        )
        assert region.get_start_time() == 0.0
        assert region.get_end_time() == 5.0

    def test_create_region_camel_case(self):
        """Can create region with camelCase times."""
        region = HighlightRegion(
            id='region-2',
            startTime=1.0,
            endTime=6.0,
            keyframes=[]
        )
        assert region.get_start_time() == 1.0
        assert region.get_end_time() == 6.0

    def test_enabled_default_true(self):
        """Regions are enabled by default."""
        region = HighlightRegion(id='r', start_time=0, end_time=1, keyframes=[])
        assert region.enabled is True

    def test_region_with_keyframes(self):
        """Can create region with keyframes."""
        region = HighlightRegion(
            id='region-3',
            start_time=0.0,
            end_time=5.0,
            keyframes=[
                HighlightKeyframe(time=0.0, x=100, y=100, radiusX=20, radiusY=40),
                HighlightKeyframe(time=5.0, x=200, y=200, radiusX=20, radiusY=40)
            ]
        )
        assert len(region.keyframes) == 2


class TestHighlightsData:
    """Test HighlightsData model."""

    def test_empty_highlights(self):
        """Can create empty highlights data."""
        data = HighlightsData()
        assert data.regions == []

    def test_from_json_list(self):
        """Can parse from raw JSON list format."""
        json_list = [
            {
                "id": "region-1",
                "start_time": 0.0,
                "end_time": 5.0,
                "enabled": True,
                "keyframes": [
                    {"time": 0.0, "x": 100, "y": 100, "radiusX": 20, "radiusY": 40}
                ]
            }
        ]
        data = HighlightsData.from_json_list(json_list)
        assert len(data.regions) == 1
        assert data.regions[0].id == 'region-1'
        assert len(data.regions[0].keyframes) == 1

    def test_to_json_list(self):
        """Can serialize to raw JSON list format."""
        data = HighlightsData(regions=[
            HighlightRegion(
                id='r1',
                start_time=0.0,
                end_time=5.0,
                keyframes=[
                    HighlightKeyframe(time=0.0, x=100, y=100, radiusX=20, radiusY=40)
                ]
            )
        ])

        json_list = data.to_json_list()
        assert len(json_list) == 1
        assert json_list[0]['id'] == 'r1'

    def test_get_enabled_regions(self):
        """Can filter to only enabled regions."""
        data = HighlightsData(regions=[
            HighlightRegion(id='r1', start_time=0, end_time=5, enabled=True, keyframes=[]),
            HighlightRegion(id='r2', start_time=5, end_time=10, enabled=False, keyframes=[]),
            HighlightRegion(id='r3', start_time=10, end_time=15, enabled=True, keyframes=[])
        ])

        enabled = data.get_enabled_regions()
        assert len(enabled) == 2
        assert enabled[0].id == 'r1'
        assert enabled[1].id == 'r3'


class TestParserFunctions:
    """Test the helper parser functions."""

    def test_parse_crop_data_valid(self):
        """parse_crop_data handles valid JSON."""
        json_str = '[{"frame": 0, "x": 100, "y": 50, "width": 640, "height": 360}]'
        result = parse_crop_data(json_str)
        assert result is not None
        assert len(result.keyframes) == 1

    def test_parse_crop_data_none(self):
        """parse_crop_data handles None."""
        assert parse_crop_data(None) is None

    def test_parse_crop_data_empty(self):
        """parse_crop_data handles empty string."""
        assert parse_crop_data('') is None

    def test_parse_crop_data_invalid(self):
        """parse_crop_data handles invalid JSON."""
        assert parse_crop_data('not json') is None
        assert parse_crop_data('{"not": "a list"}') is None

    def test_parse_timing_data_valid(self):
        """parse_timing_data handles valid JSON."""
        json_str = '{"trimRange": [1.5, 8.5]}'
        result = parse_timing_data(json_str)
        assert result is not None
        assert result.trimRange == (1.5, 8.5)

    def test_parse_timing_data_none(self):
        """parse_timing_data handles None."""
        assert parse_timing_data(None) is None

    def test_parse_segments_data_valid(self):
        """parse_segments_data handles valid JSON."""
        json_str = '{"boundaries": [0, 5, 10], "segmentSpeeds": {"0": 1.0}}'
        result = parse_segments_data(json_str)
        assert result is not None
        assert result.boundaries == [0, 5, 10]

    def test_parse_segments_data_none(self):
        """parse_segments_data handles None."""
        assert parse_segments_data(None) is None

    def test_parse_highlights_data_valid(self):
        """parse_highlights_data handles valid JSON."""
        json_str = '[{"id": "r1", "start_time": 0, "end_time": 5, "keyframes": []}]'
        result = parse_highlights_data(json_str)
        assert result is not None
        assert len(result.regions) == 1

    def test_parse_highlights_data_none(self):
        """parse_highlights_data handles None."""
        assert parse_highlights_data(None) is None


class TestRealWorldData:
    """Test with data structures similar to actual frontend output."""

    def test_crop_data_from_frontend(self):
        """Parse crop data as generated by useCrop hook."""
        # Simulates what the frontend generates via getKeyframesForExport
        frontend_data = [
            {
                "frame": 0,
                "x": 387.5,
                "y": 37.5,
                "width": 205,
                "height": 365,
                "origin": "permanent"
            },
            {
                "frame": 150,
                "x": 420,
                "y": 50,
                "width": 205,
                "height": 365,
                "origin": "user"
            },
            {
                "frame": 300,
                "x": 387.5,
                "y": 37.5,
                "width": 205,
                "height": 365,
                "origin": "permanent"
            }
        ]

        data = CropData.from_json_list(frontend_data)
        assert len(data.keyframes) == 3
        assert data.keyframes[0].origin == 'permanent'
        assert data.keyframes[1].origin == 'user'
        assert data.keyframes[2].origin == 'permanent'

    def test_segments_data_from_frontend(self):
        """Parse segments data as stored by useClipManager."""
        frontend_data = {
            "boundaries": [0, 10.5],
            "userSplits": [],
            "trimRange": None,
            "segmentSpeeds": {}
        }

        data = SegmentsData(**frontend_data)
        assert data.boundaries == [0, 10.5]
        assert data.trimRange is None

    def test_highlights_data_from_export(self):
        """Parse highlights data as generated by getRegionsForExport."""
        export_data = [
            {
                "id": "region-1703123456789-abc123def",
                "start_time": 0.0,
                "end_time": 5.0,
                "keyframes": [
                    {
                        "time": 0.0,
                        "x": 480,
                        "y": 270,
                        "radiusX": 32,
                        "radiusY": 65,
                        "opacity": 0.15,
                        "color": "#FFFF00"
                    },
                    {
                        "time": 5.0,
                        "x": 520,
                        "y": 290,
                        "radiusX": 32,
                        "radiusY": 65,
                        "opacity": 0.15,
                        "color": "#FFFF00"
                    }
                ]
            }
        ]

        data = HighlightsData.from_json_list(export_data)
        assert len(data.regions) == 1
        assert data.regions[0].get_start_time() == 0.0
        assert len(data.regions[0].keyframes) == 2
        assert data.regions[0].keyframes[0].color == '#FFFF00'
