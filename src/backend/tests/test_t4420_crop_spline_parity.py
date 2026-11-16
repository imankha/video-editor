"""
T4420: one fixture, every live copy of the crop curve maths, same rectangles.

Live copies of the Catmull-Rom crop spline:
- `app/ai_upscaler/keyframe_interpolator.py` (local upscaler / overlay renderer)
- `app/modal_functions/video_processing.py` `_interpolate_crop` (inline by policy:
  the Modal image does not mount `app/`)
- `app/highlight_transform.py` `interpolate_crop_at_frame` (Spotlight mapping;
  frame-based keyframes, delegates to the local upscaler's copy)

The linear crop module and the optimized benchmark Modal app were dead
(deleted by T16500) and are deliberately not listed. The frontend's
`interpolateCropSpline` is checked by `src/utils/splineInterpolation.test.js`.
"""

import pytest

from app.ai_upscaler.keyframe_interpolator import KeyframeInterpolator
from app.highlight_transform import interpolate_crop_at_frame
from app.modal_functions.video_processing import _interpolate_crop as modal_interpolate_crop

FPS = 30.0

# Four keyframes, uneven spacing, every property moving (zoom included).
FIXTURE_FRAMES = [
    {'frame': 0, 'x': 100.0, 'y': 40.0, 'width': 608.0, 'height': 1080.0},
    {'frame': 45, 'x': 1200.0, 'y': 0.0, 'width': 540.0, 'height': 960.0},
    {'frame': 75, 'x': 300.0, 'y': 90.0, 'width': 608.0, 'height': 1080.0},
    {'frame': 150, 'x': 700.0, 'y': 10.0, 'width': 480.0, 'height': 853.0},
]

SAMPLE_FRAMES = [0, 1, 15, 22, 44, 45, 46, 60, 74, 75, 100, 149, 150, 200]

PROPS = ('x', 'y', 'width', 'height')


def _time_keyframes():
    return [
        {'time': kf['frame'] / FPS, **{p: kf[p] for p in PROPS}}
        for kf in FIXTURE_FRAMES
    ]


def _rect(crop):
    return {p: crop[p] for p in PROPS}


@pytest.mark.parametrize('frame', SAMPLE_FRAMES)
def test_every_copy_gives_the_same_rectangle(frame):
    time = frame / FPS
    local = _rect(KeyframeInterpolator.interpolate_crop(_time_keyframes(), time))
    modal = _rect(modal_interpolate_crop(_time_keyframes(), time))
    spotlight = _rect(interpolate_crop_at_frame(FIXTURE_FRAMES, frame))

    for prop in PROPS:
        assert modal[prop] == pytest.approx(local[prop], abs=1e-6), f'modal {prop} @ frame {frame}'
        assert spotlight[prop] == pytest.approx(local[prop], abs=1e-6), f'spotlight {prop} @ frame {frame}'


def test_fixture_is_a_curve_not_a_line():
    """Guard: at a mid frame the curve differs from straight-line interpolation
    by more than a pixel, so the parity test above can tell the two apart."""
    local = KeyframeInterpolator.interpolate_crop(_time_keyframes(), 22 / FPS)
    linear_x = 100.0 + (22 / 45) * (1200.0 - 100.0)
    assert abs(local['x'] - linear_x) > 1.0
