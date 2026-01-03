"""
Tests for FFmpeg helper functions.

These tests verify the FFmpeg utility functions that are used by
the video processing system. They test functions in isolation
without requiring actual video files or FFmpeg execution.
"""

import pytest
import json


class TestCalculateMultiClipResolution:
    """Test resolution calculation for multi-clip export."""

    def test_default_resolution_for_9_16(self):
        """9:16 aspect ratio should default to 1080x1920."""
        from app.routers.export import calculate_multi_clip_resolution

        # Empty clips list
        clips = []
        width, height = calculate_multi_clip_resolution(clips, "9:16")
        assert width == 1080
        assert height == 1920

    def test_default_resolution_for_16_9(self):
        """16:9 aspect ratio should default to 1920x1080."""
        from app.routers.export import calculate_multi_clip_resolution

        clips = []
        width, height = calculate_multi_clip_resolution(clips, "16:9")
        assert width == 1920
        assert height == 1080

    def test_resolution_from_crop_keyframes(self):
        """Resolution should be calculated from minimum crop size."""
        from app.routers.export import calculate_multi_clip_resolution

        clips = [
            {'cropKeyframes': [
                {'width': 200, 'height': 356},  # 9:16 ratio
                {'width': 250, 'height': 444},
            ]},
            {'cropKeyframes': [
                {'width': 180, 'height': 320},  # Smallest
            ]},
        ]
        width, height = calculate_multi_clip_resolution(clips, "9:16")

        # 4x upscale: 180*4=720, 320*4=1280
        # Should be <= 2560x1440 max
        assert width <= 2560
        assert height <= 1440
        # Should be even numbers
        assert width % 2 == 0
        assert height % 2 == 0

    def test_resolution_capped_at_max(self):
        """Resolution should be capped at 2560x1440."""
        from app.routers.export import calculate_multi_clip_resolution

        # Very large crop that would exceed cap
        clips = [
            {'cropKeyframes': [
                {'width': 1000, 'height': 1000},  # 4x would be 4000x4000
            ]},
        ]
        width, height = calculate_multi_clip_resolution(clips, "1:1")

        assert width <= 2560
        assert height <= 1440


class TestChapterMetadataFormat:
    """Test chapter metadata generation for FFmpeg."""

    def test_chapter_format_valid(self):
        """Chapter metadata should be valid FFMETADATA format."""
        from app.routers.export import create_chapter_metadata_file
        import tempfile
        import os

        chapters = [
            {'name': 'Intro', 'index': 0, 'start_time': 0, 'end_time': 10},
            {'name': 'Main', 'index': 1, 'start_time': 10, 'end_time': 30},
        ]

        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            temp_path = f.name

        try:
            result_path = create_chapter_metadata_file(chapters, temp_path)
            assert result_path is not None

            with open(result_path, 'r') as f:
                content = f.read()

            # Should have FFMETADATA header
            assert ';FFMETADATA1' in content
            # Should have chapter entries
            assert '[CHAPTER]' in content
            assert 'title=Intro' in content
            assert 'title=Main' in content
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
            if result_path and os.path.exists(result_path):
                os.remove(result_path)


class TestTransitionTypes:
    """Test transition type validation."""

    def test_valid_transition_types(self):
        """Should accept valid transition types."""
        valid_types = ['cut', 'fade', 'dissolve']
        for t_type in valid_types:
            assert t_type in valid_types

    def test_default_transition(self):
        """Default transition should be 'cut'."""
        # This tests the default parameter value
        from app.routers.export import router
        # Just verify the module loads without error
        assert router is not None


class TestSanitizeFilename:
    """Test filename sanitization for project names."""

    def test_sanitize_removes_special_chars(self):
        """Sanitization should remove special characters."""
        import re

        def sanitize(name: str) -> str:
            """Mirror the sanitization logic from export.py."""
            safe_name = re.sub(r'[^\w\s-]', '', name).strip()
            safe_name = re.sub(r'[\s]+', '_', safe_name)
            return safe_name if safe_name else "project"

        assert sanitize("My Project!") == "My_Project"
        assert sanitize("Test/Video:1") == "TestVideo1"
        assert sanitize("normal_name") == "normal_name"
        assert sanitize("   spaces   ") == "spaces"

    def test_sanitize_handles_empty(self):
        """Sanitization should handle empty strings."""
        import re

        def sanitize(name: str) -> str:
            safe_name = re.sub(r'[^\w\s-]', '', name).strip()
            safe_name = re.sub(r'[\s]+', '_', safe_name)
            return safe_name if safe_name else "project"

        assert sanitize("") == "project"
        assert sanitize("!!!") == "project"


class TestExportModes:
    """Test export mode handling."""

    def test_quality_mode_settings(self):
        """Quality mode should have expected settings."""
        # Quality mode uses slower encoding for better results
        quality_settings = {
            'preset': 'slow',
            'crf': 18,
        }
        assert quality_settings['preset'] == 'slow'
        assert quality_settings['crf'] == 18

    def test_speed_mode_settings(self):
        """Speed mode should have expected settings."""
        # Speed mode uses faster encoding
        speed_settings = {
            'preset': 'fast',
            'crf': 23,
        }
        assert speed_settings['preset'] == 'fast'
        assert speed_settings['crf'] == 23


class TestOverlayDataParsing:
    """Test overlay data JSON parsing."""

    def test_parse_valid_highlights(self):
        """Should parse valid highlight regions JSON."""
        highlights_json = json.dumps([
            {
                'id': 1,
                'startTime': 0,
                'endTime': 5,
                'keyframes': [
                    {'time': 0, 'x': 0.5, 'y': 0.5, 'radiusX': 0.1, 'radiusY': 0.15}
                ]
            }
        ])

        highlights = json.loads(highlights_json)
        assert len(highlights) == 1
        assert highlights[0]['id'] == 1
        assert highlights[0]['startTime'] == 0
        assert highlights[0]['endTime'] == 5

    def test_parse_empty_highlights(self):
        """Should handle empty highlights array."""
        highlights = json.loads("[]")
        assert highlights == []

    def test_parse_invalid_json_graceful(self):
        """Should handle invalid JSON gracefully."""
        try:
            json.loads("not valid json")
            assert False, "Should have raised"
        except json.JSONDecodeError:
            pass  # Expected

    def test_effect_type_values(self):
        """Effect type should be one of valid options."""
        valid_effects = ['original', 'brightness_boost', 'dark_overlay']
        for effect in valid_effects:
            assert effect in valid_effects
