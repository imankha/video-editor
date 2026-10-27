"""T13520: the rendered spotlight holds its last keyframe until the region ends.

A region stored with picks at [0.0, 0.667] (the editor's memory-only boundary
keyframes are never persisted) must still draw at t=1.0/1.6 inside a [0, 2.0]
region, matching the frontend's interpolateGenericSpline hold.
"""
import numpy as np
import pytest

from app.ai_upscaler.keyframe_interpolator import KeyframeInterpolator
from app.modal_functions import video_processing as vp
from app.routers.export.overlay import _keyframes_within_bounds

SETTINGS = {"highlight_shape": "ground", "dim_strength": 0.4,
            "fill_enabled": True, "fill_opacity": 0.2, "stroke_width": 2}


def _kf(t, x):
    return {"time": t, "x": x, "y": 50, "radiusX": 10, "radiusY": 15,
            "strokeOpacity": 0.85, "fillOpacity": 0.05, "color": "#FFFF00"}


def _region():
    return {"id": "r", "start_time": 0.0, "end_time": 2.0, "enabled": True,
            "keyframes": [_kf(0.0, 30), _kf(0.6667, 60)]}


@pytest.mark.parametrize("t", [0.3, 1.0, 1.6])
def test_modal_render_draws_through_region_end(t):
    frame = np.full((100, 100, 3), 200, np.uint8)
    out = vp._render_highlight(frame.copy(), _region(), t, "dark_overlay", SETTINGS)
    assert not np.array_equal(out, frame)


@pytest.mark.parametrize("t", [1.0, 1.6])
def test_local_interpolation_holds_last_keyframe(t):
    region = _region()
    result = KeyframeInterpolator.interpolate_highlight(_keyframes_within_bounds(region), t)
    assert result is not None
    assert result["x"] == 60
