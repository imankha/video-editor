"""
Test to replicate the highlight persistence bug.

Scenario from user A's account:
- Project 2 (Great_Control_Pass_clip): 9:16 portrait, created highlights on raw_clip 1
- Project 1 (wcfc-carlsbad-trimmed_game): 16:9 landscape, should load highlights as defaults

The raw_clip has default_highlight_regions saved, but when project 1 opens
overlay mode, the highlights don't appear.
"""

import pytest
import json
from app.highlight_transform import (
    transform_all_regions_to_working,
    transform_highlight_region_to_working,
    raw_frame_to_working_time,
    raw_coords_to_working_coords,
    interpolate_crop_at_frame,
)


# Actual data from user A's database
RAW_CLIP_HIGHLIGHTS = [
    {
        "id": "region-auto-0-1768251321330-q3ysvi1",
        "raw_start_frame": 0,
        "raw_end_frame": 44,
        "duration_seconds": 2,
        "keyframes": [
            {
                "raw_frame": 0,
                "raw_x": 1190.4421786346245,
                "raw_y": 454.5201136871338,
                "raw_radiusX": 10.43975965056089,
                "raw_radiusY": 24.604910527038577,
                "opacity": 0.15,
                "color": "#FFFF00",
                "player_image_path": "highlights/clip_1_frame_0_kf0.png"
            },
            {
                "raw_frame": 10,
                "raw_x": 1170.5022893151388,
                "raw_y": 440.9894230363574,
                "raw_radiusX": 7.465794827111877,
                "raw_radiusY": 13.656672877120974,
                "opacity": 0.15,
                "color": "#FFFF00",
                "player_image_path": "highlights/clip_1_frame_10_kf1.png"
            },
            {
                "raw_frame": 27,
                "raw_x": 1090.9993879826732,
                "raw_y": 435.18732572678573,
                "raw_radiusX": 15.116803254950494,
                "raw_radiusY": 36.984823425,
                "opacity": 0.15,
                "color": "#FFFF00",
                "player_image_path": "highlights/clip_1_frame_27_kf2.png"
            },
            {
                "raw_frame": 42,
                "raw_x": 1031.6007917430534,
                "raw_y": 443.7200488943548,
                "raw_radiusX": 9.788060717821782,
                "raw_radiusY": 22.848292837500004,
                "opacity": 0.15,
                "color": "#FFFF00",
                "player_image_path": "highlights/clip_1_frame_42_kf3.png"
            }
        ]
    }
]

# Project 1's framing data (16:9 landscape, where bug occurs)
PROJECT_1_CROP_KEYFRAMES = [
    {"x": 814.893, "y": 320.961, "width": 640, "height": 360, "frame": 0, "origin": "permanent"},
    {"x": 700.9, "y": 298.026, "width": 619.7, "height": 348.581, "frame": 44, "origin": "user"},
    {"x": 814.893, "y": 320.961, "width": 640, "height": 360, "frame": 104, "origin": "permanent"}
]

PROJECT_1_SEGMENTS_DATA = {
    "boundaries": [0, 3.453322, 6.009],
    "segmentSpeeds": {},
    "trimRange": {"start": 0, "end": 3.453322}
}

# Project 1's working video dimensions (16:9)
PROJECT_1_WORKING_VIDEO_DIMS = {"width": 1080, "height": 607}  # 16:9 aspect

# Project 2's framing data (9:16 portrait, where highlights were created)
PROJECT_2_CROP_KEYFRAMES = [
    {"x": 1112.532, "y": 187.791, "width": 315.87, "height": 561.546, "frame": 0, "origin": "permanent"},
    {"x": 931.393, "y": 184.668, "width": 315.87, "height": 561.546, "frame": 28, "origin": "user"},
    {"x": 877.654, "y": 199.007, "width": 315.87, "height": 561.546, "frame": 59, "origin": "user"},
    {"x": 1112.532, "y": 187.791, "width": 315.87, "height": 561.546, "frame": 180, "origin": "permanent"}
]

PROJECT_2_SEGMENTS_DATA = {
    "boundaries": [0, 0.5401820356196645, 6.009],
    "segmentSpeeds": {"0": 0.5},
    "trimRange": None
}

# Project 2's working video dimensions (9:16)
PROJECT_2_WORKING_VIDEO_DIMS = {"width": 1080, "height": 1920}


class TestHighlightPersistenceBug:
    """Replicate the exact bug from user A's account."""

    def test_raw_keyframe_visibility_in_project_1_crop(self):
        """
        First, verify that raw keyframe positions ARE within Project 1's crop bounds.
        If they're not visible, that would explain why they don't show up.
        """
        framerate = 30.0

        for kf in RAW_CLIP_HIGHLIGHTS[0]['keyframes']:
            raw_frame = kf['raw_frame']
            raw_x = kf['raw_x']
            raw_y = kf['raw_y']

            # Get crop at this frame
            crop = interpolate_crop_at_frame(PROJECT_1_CROP_KEYFRAMES, raw_frame)

            # Check if point is within crop bounds
            crop_x1 = crop['x']
            crop_y1 = crop['y']
            crop_x2 = crop['x'] + crop['width']
            crop_y2 = crop['y'] + crop['height']

            is_visible = (crop_x1 <= raw_x <= crop_x2) and (crop_y1 <= raw_y <= crop_y2)

            print(f"Frame {raw_frame}: raw=({raw_x:.1f}, {raw_y:.1f}), "
                  f"crop=({crop_x1:.1f}-{crop_x2:.1f}, {crop_y1:.1f}-{crop_y2:.1f}), "
                  f"visible={is_visible}")

            # Assert visibility - if this fails, we found the issue
            assert is_visible, f"Keyframe at frame {raw_frame} not visible in crop"

    def test_raw_frame_to_working_time_project_1(self):
        """
        Test that raw frames map to valid working times in Project 1.
        Project 1 has trim from 0 to 3.45s, so frames 0-103 should be visible.
        """
        framerate = 30.0

        for kf in RAW_CLIP_HIGHLIGHTS[0]['keyframes']:
            raw_frame = kf['raw_frame']

            working_time = raw_frame_to_working_time(
                raw_frame=raw_frame,
                segments_data=PROJECT_1_SEGMENTS_DATA,
                framerate=framerate
            )

            print(f"Frame {raw_frame} -> working_time={working_time}")

            # Should not be None (within trim range)
            assert working_time is not None, f"Frame {raw_frame} returned None working_time"

            # Should be within project 1's trim range (0 to 3.45s)
            assert 0 <= working_time <= 3.5, f"Working time {working_time} out of range"

    def test_transform_single_keyframe_to_working(self):
        """
        Test transforming a single raw keyframe to Project 1's working space.
        """
        framerate = 30.0
        kf = RAW_CLIP_HIGHLIGHTS[0]['keyframes'][0]  # First keyframe

        raw_frame = kf['raw_frame']
        raw_x = kf['raw_x']
        raw_y = kf['raw_y']
        raw_radiusX = kf['raw_radiusX']
        raw_radiusY = kf['raw_radiusY']

        # Get crop at frame
        crop = interpolate_crop_at_frame(PROJECT_1_CROP_KEYFRAMES, raw_frame)

        # Transform coordinates
        result = raw_coords_to_working_coords(
            raw_x=raw_x,
            raw_y=raw_y,
            raw_radiusX=raw_radiusX,
            raw_radiusY=raw_radiusY,
            crop=crop,
            working_video_dims=PROJECT_1_WORKING_VIDEO_DIMS
        )

        print(f"Crop at frame 0: {crop}")
        print(f"Raw coords: ({raw_x}, {raw_y})")
        print(f"Transform result: {result}")

        assert result is not None, "Transform returned None"
        assert result.get('visible', False), f"Transform marked as not visible: {result}"

    def test_transform_region_to_project_1(self):
        """
        Test the full region transformation to Project 1's working video space.
        This is the actual code path used in get_overlay_data.
        """
        framerate = 30.0

        transformed = transform_all_regions_to_working(
            raw_regions=RAW_CLIP_HIGHLIGHTS,
            crop_keyframes=PROJECT_1_CROP_KEYFRAMES,
            segments_data=PROJECT_1_SEGMENTS_DATA,
            working_video_dims=PROJECT_1_WORKING_VIDEO_DIMS,
            framerate=framerate
        )

        print(f"Transformed regions: {json.dumps(transformed, indent=2)}")

        # Should have at least one region
        assert len(transformed) > 0, "No regions were transformed"

        # Check the region has keyframes
        region = transformed[0]
        assert 'keyframes' in region, "Region missing keyframes"
        assert len(region['keyframes']) > 0, "Region has no keyframes"

        print(f"Transformed region has {len(region['keyframes'])} keyframes")

    def test_transform_region_to_project_2_roundtrip(self):
        """
        For comparison, test transforming back to Project 2's space.
        This should work since that's where the highlights came from.
        """
        framerate = 30.0

        transformed = transform_all_regions_to_working(
            raw_regions=RAW_CLIP_HIGHLIGHTS,
            crop_keyframes=PROJECT_2_CROP_KEYFRAMES,
            segments_data=PROJECT_2_SEGMENTS_DATA,
            working_video_dims=PROJECT_2_WORKING_VIDEO_DIMS,
            framerate=framerate
        )

        print(f"Project 2 transformed regions: {json.dumps(transformed, indent=2)}")

        assert len(transformed) > 0, "No regions transformed for project 2"
        assert len(transformed[0]['keyframes']) > 0, "No keyframes in project 2 region"


class TestAPICodePath:
    """
    Test the actual API code path to find where the bug is.
    """

    def test_check_working_video_highlights_query(self):
        """
        Check if get_overlay_data finds existing highlights for project 1.

        This is the first query in get_overlay_data - if it finds data,
        it won't fall back to raw_clips.
        """
        import sqlite3
        from pathlib import Path

        db_path = Path("C:/Users/imank/projects/video-editor/user_data/a/database.sqlite")

        if not db_path.exists():
            pytest.skip("User A database not found")

        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        project_id = 1  # wcfc-carlsbad-trimmed_game

        # This is the exact query from get_overlay_data
        cursor.execute("""
            SELECT highlights_data, text_overlays, effect_type
            FROM working_videos
            WHERE project_id = ?
            ORDER BY version DESC
            LIMIT 1
        """, (project_id,))

        result = cursor.fetchone()
        conn.close()

        print(f"\nWorking video for project {project_id}:")
        if result:
            print(f"  highlights_data: '{result['highlights_data']}'")
            print(f"  text_overlays: '{result['text_overlays']}'")
            print(f"  effect_type: '{result['effect_type']}'")

            # Check what the code does with this result
            highlights_data = result['highlights_data']
            highlights = []

            if highlights_data:
                try:
                    highlights = json.loads(highlights_data)
                    print(f"  Parsed highlights: {len(highlights)} regions")
                except json.JSONDecodeError:
                    print(f"  Failed to parse highlights_data")
            else:
                print(f"  highlights_data is falsy, will check raw_clips")

            # The bug might be here - if highlights_data is empty string "",
            # `if highlights_data:` is False, but `if not highlights:` after parsing
            # should still trigger the fallback
            print(f"\n  bool(highlights_data) = {bool(highlights_data)}")
            print(f"  bool(highlights) = {bool(highlights)}")
            print(f"  not highlights = {not highlights}")
        else:
            print(f"  No working video found!")


    def test_api_endpoint_integration(self):
        """
        Test the actual API endpoint returns highlight data.

        NOTE: Requires the backend server to be running on localhost:8000.
        Skip this test if server is not available.
        """
        import requests

        try:
            response = requests.get(
                "http://localhost:8000/api/export/projects/1/overlay-data",
                headers={"X-User-ID": "a"},
                timeout=5
            )
        except (requests.exceptions.ConnectionError, requests.exceptions.ReadTimeout):
            pytest.skip("Backend server not running or timed out")

        print(f"\nAPI Response status: {response.status_code}")
        print(f"Response JSON: {json.dumps(response.json(), indent=2)}")

        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert 'highlights_data' in data
        assert 'from_raw_clip' in data

        # Should have loaded highlights from raw_clip
        if data.get('from_raw_clip'):
            assert len(data['highlights_data']) > 0, "Expected highlights from raw_clip"
            print(f"\n SUCCESS: Loaded {len(data['highlights_data'])} regions from raw_clip!")
        else:
            print(f"\n Note: from_raw_clip is False, highlights may be project-specific")


class TestLowLevelTransformFunctions:
    """Test the individual transform functions with the actual data."""

    def test_interpolate_crop_at_frame_0(self):
        """Test crop interpolation at frame 0."""
        crop = interpolate_crop_at_frame(PROJECT_1_CROP_KEYFRAMES, 0)

        print(f"Crop at frame 0: {crop}")

        assert crop['x'] == 814.893
        assert crop['y'] == 320.961
        assert crop['width'] == 640
        assert crop['height'] == 360

    def test_interpolate_crop_at_frame_22(self):
        """Test crop interpolation at frame 22 (between keyframes 0 and 44)."""
        crop = interpolate_crop_at_frame(PROJECT_1_CROP_KEYFRAMES, 22)

        print(f"Crop at frame 22: {crop}")

        # Should be interpolated between frame 0 and frame 44
        # Frame 22 is 50% between 0 and 44
        expected_x = (814.893 + 700.9) / 2
        assert abs(crop['x'] - expected_x) < 1, f"Expected x ~{expected_x}, got {crop['x']}"

    def test_raw_coords_visibility_check(self):
        """
        Test that raw_coords_to_working_coords correctly determines visibility.
        """
        # Point inside crop
        crop = {"x": 800, "y": 300, "width": 640, "height": 360}
        working_dims = {"width": 1080, "height": 607}

        # Point at (1100, 450) is inside crop (800-1440, 300-660)
        result = raw_coords_to_working_coords(
            raw_x=1100, raw_y=450,
            raw_radiusX=10, raw_radiusY=20,
            crop=crop,
            working_video_dims=working_dims
        )

        print(f"Inside crop result: {result}")
        assert result is not None
        assert result.get('visible', False), "Point should be visible"

        # Point outside crop (x too small)
        result2 = raw_coords_to_working_coords(
            raw_x=700, raw_y=450,  # x=700 is outside 800-1440
            raw_radiusX=10, raw_radiusY=20,
            crop=crop,
            working_video_dims=working_dims
        )

        print(f"Outside crop result: {result2}")
        # Should either be None or have visible=False
        if result2 is not None:
            assert not result2.get('visible', True), "Point should not be visible"
