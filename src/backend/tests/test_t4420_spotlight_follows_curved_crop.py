"""
T4420: the Spotlight circle follows the curved crop.

Between Frame's crop keyframes every renderer moves the crop along a Catmull-Rom
curve (local upscaler `KeyframeInterpolator.interpolate_crop`, Modal
`video_processing._interpolate_crop`). The Spotlight mapping
(`highlight_transform.transform_keyframe_to_raw`, fed by
`interpolate_crop_at_frame`) must place the circle against that SAME crop
rectangle, or with three or more crop keyframes the circle drifts off the
athlete in the rendered video.

Crop keyframes in `crop_data` are frame-based; the renderers get them in
seconds (frame / fps). Real sizes: 1920x1080 source, 9:16 crop, 1080x1920
working video.
"""

import pytest

from app.ai_upscaler.keyframe_interpolator import KeyframeInterpolator
from app.highlight_transform import transform_keyframe_to_raw
from app.modal_functions.video_processing import _interpolate_crop as modal_interpolate_crop

FPS = 30.0
WORKING_DIMS = {'width': 1080, 'height': 1920}

# Three crop keyframes on a curve: the athlete runs right, then cuts back left.
CROP_FRAMES = [
    {'frame': 0, 'x': 100.0, 'y': 0.0, 'width': 608.0, 'height': 1080.0},
    {'frame': 60, 'x': 1200.0, 'y': 0.0, 'width': 608.0, 'height': 1080.0},
    {'frame': 120, 'x': 300.0, 'y': 0.0, 'width': 608.0, 'height': 1080.0},
]


def _renderer_keyframes():
    return [
        {'time': kf['frame'] / FPS, 'x': kf['x'], 'y': kf['y'],
         'width': kf['width'], 'height': kf['height']}
        for kf in CROP_FRAMES
    ]


@pytest.mark.parametrize('renderer', ['local', 'modal'])
def test_spotlight_mapping_uses_renderer_crop_at_mid_frame(renderer):
    mid_frame = 30  # halfway between the first two crop keyframes
    mid_time = mid_frame / FPS

    if renderer == 'local':
        rendered_crop = KeyframeInterpolator.interpolate_crop(_renderer_keyframes(), mid_time)
    else:
        rendered_crop = modal_interpolate_crop(_renderer_keyframes(), mid_time)

    # A Spotlight circle drawn at the centre of the working (rendered) video.
    spotlight = {'time': mid_time, 'x': 540.0, 'y': 960.0, 'radiusX': 60.0, 'radiusY': 100.0}
    raw = transform_keyframe_to_raw(spotlight, CROP_FRAMES, None, WORKING_DIMS, FPS)

    assert raw['raw_frame'] == mid_frame
    # The centre of the working video is the centre of the rendered crop rectangle.
    assert raw['raw_x'] == pytest.approx(rendered_crop['x'] + rendered_crop['width'] / 2, abs=1e-6)
    assert raw['raw_y'] == pytest.approx(rendered_crop['y'] + rendered_crop['height'] / 2, abs=1e-6)
