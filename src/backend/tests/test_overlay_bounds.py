"""
Tests for T270: Overlay renders outside region bounds.

Verifies that keyframes outside region start_time/end_time are filtered
before rendering, so the overlay effect only appears within region bounds.
"""

import pytest
from app.ai_upscaler.keyframe_interpolator import KeyframeInterpolator


class TestKeyframeInterpolatorRegionBounds:
    """Test that interpolate_highlight respects region time bounds."""

    def _make_keyframes(self, times):
        """Create keyframes at given times with dummy positions."""
        return [
            {"time": t, "x": 100 + t * 10, "y": 200 + t * 10,
             "radiusX": 50, "radiusY": 80, "opacity": 0.15, "color": "#FFFF00"}
            for t in times
        ]

    def test_keyframes_within_bounds_render_normally(self):
        """Keyframes fully within region bounds should render as before."""
        keyframes = self._make_keyframes([1.0, 2.0, 3.0])
        result = KeyframeInterpolator.interpolate_highlight(keyframes, 2.0)
        assert result is not None
        assert result["x"] == pytest.approx(120.0)

    def test_keyframes_outside_region_filtered_by_caller(self):
        """
        When keyframes are filtered to region bounds, interpolation
        should only use in-bounds keyframes.

        Scenario: Region is [1.0, 2.0] but keyframes exist at [0.0, 1.0, 2.0, 3.0].
        After filtering to [1.0, 2.0], only keyframes at t=1 and t=2 remain.
        """
        all_keyframes = self._make_keyframes([0.0, 1.0, 2.0, 3.0])

        # Filter to region bounds [1.0, 2.0]
        filtered = [kf for kf in all_keyframes if 1.0 <= kf["time"] <= 2.0]
        assert len(filtered) == 2

        # Interpolation at t=1.5 should use only the filtered keyframes
        result = KeyframeInterpolator.interpolate_highlight(filtered, 1.5)
        assert result is not None
        # x at t=1 is 110, at t=2 is 120, midpoint should be 115
        assert result["x"] == pytest.approx(115.0)

    def test_no_keyframes_in_region_returns_none(self):
        """If all keyframes are outside region bounds, filtering leaves empty list -> None."""
        all_keyframes = self._make_keyframes([0.0, 0.5])

        # Region is [2.0, 3.0], all keyframes are before it
        filtered = [kf for kf in all_keyframes if 2.0 <= kf["time"] <= 3.0]
        assert len(filtered) == 0

        result = KeyframeInterpolator.interpolate_highlight(filtered, 2.5)
        assert result is None

    def test_single_keyframe_in_region_renders(self):
        """A single keyframe within bounds should still render."""
        all_keyframes = self._make_keyframes([0.0, 1.5, 3.0])

        # Region is [1.0, 2.0], only keyframe at t=1.5 is in bounds
        filtered = [kf for kf in all_keyframes if 1.0 <= kf["time"] <= 2.0]
        assert len(filtered) == 1

        result = KeyframeInterpolator.interpolate_highlight(filtered, 1.5)
        assert result is not None


class TestRenderHighlightKeyframeFiltering:
    """Test that _render_highlight in video_processing.py filters keyframes to region bounds."""

    def test_render_highlight_filters_keyframes_to_region_bounds(self):
        """
        _render_highlight should only use keyframes within [start_time, end_time].
        With in-bounds keyframes, the overlay should be applied.
        """
        from app.modal_functions.video_processing import _render_highlight
        import numpy as np

        # Use a white frame so dark_overlay dimming is visible
        frame = np.full((100, 100, 3), 200, dtype=np.uint8)

        # Region from t=1.0 to t=2.0, with keyframes inside AND outside bounds
        region = {
            "start_time": 1.0,
            "end_time": 2.0,
            "keyframes": [
                {"time": 0.0, "x": 50, "y": 50, "radiusX": 10, "radiusY": 10, "opacity": 0.5, "color": "#FFFF00"},
                {"time": 1.0, "x": 50, "y": 50, "radiusX": 10, "radiusY": 10, "opacity": 0.5, "color": "#FFFF00"},
                {"time": 2.0, "x": 50, "y": 50, "radiusX": 10, "radiusY": 10, "opacity": 0.5, "color": "#FFFF00"},
                {"time": 3.0, "x": 50, "y": 50, "radiusX": 10, "radiusY": 10, "opacity": 0.5, "color": "#FFFF00"},
            ],
            "enabled": True,
        }

        # Render at t=1.5 (within region) - should apply dark overlay (dimming outside ellipse)
        result = _render_highlight(frame.copy(), region, 1.5, "dark_overlay")
        # Frame should be different from original (overlay applied)
        assert not np.array_equal(result, frame)

    def test_render_highlight_no_keyframes_in_region_returns_unmodified(self):
        """
        If all keyframes are outside region bounds, _render_highlight should
        return the frame unmodified.
        """
        from app.modal_functions.video_processing import _render_highlight
        import numpy as np

        frame = np.full((100, 100, 3), 200, dtype=np.uint8)

        # Region from t=5.0 to t=6.0, but keyframes are at t=0.0 and t=1.0
        region = {
            "start_time": 5.0,
            "end_time": 6.0,
            "keyframes": [
                {"time": 0.0, "x": 50, "y": 50, "radiusX": 10, "radiusY": 10, "opacity": 0.5, "color": "#FFFF00"},
                {"time": 1.0, "x": 50, "y": 50, "radiusX": 10, "radiusY": 10, "opacity": 0.5, "color": "#FFFF00"},
            ],
            "enabled": True,
        }

        # At t=5.5, there are no keyframes within [5.0, 6.0], so frame should be unmodified
        result = _render_highlight(frame.copy(), region, 5.5, "dark_overlay")
        assert np.array_equal(result, frame)
