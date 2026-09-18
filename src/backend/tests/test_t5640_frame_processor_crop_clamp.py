"""T5640 data-loss fix (2026-09-18) — FrameProcessor.extract_frame_with_crop
must clamp a rotated crop to the safe area ITSELF, not trust the caller.

Crop keyframes now store the user's true framing verbatim (the destructive
write-time clamp that used to live in useCrop.setRotation on the frontend is
gone -- see that function's docstring for the full mechanism/numbers). The
plain min/max bounds-guard `extract_frame_with_crop` already had only keeps
the crop inside the FRAME rectangle -- it does not know about the rotated
frame's smaller inscribed safe area, so it still permits black wedges into
the render. These tests pin the safe-area clamp this task adds.
"""

from unittest.mock import MagicMock, patch

import numpy as np
import pytest

pytest.importorskip("torch")

import torch

from app.ai_upscaler.frame_processor import FrameProcessor


def _make_processor(rotation):
    fp = FrameProcessor(
        model_manager=MagicMock(),
        frame_enhancer=MagicMock(),
        device=torch.device('cpu'),
    )
    fp.rotation = rotation
    return fp


def _fake_capture(frame):
    """A cv2.VideoCapture stand-in whose .read() always returns the given frame."""
    cap = MagicMock()
    cap.set.return_value = True
    cap.read.return_value = (True, frame.copy())
    cap.release.return_value = None
    return cap


def test_no_rotation_leaves_the_old_plain_bounds_guard_unchanged():
    """theta=0 must be byte-identical to the pre-fix behavior (no clamp import
    engaged at all) -- the crop is used exactly as given, bounds-guard aside."""
    frame = np.full((1080, 1920, 3), 200, dtype=np.uint8)
    fp = _make_processor(rotation=0)
    with patch('cv2.VideoCapture', return_value=_fake_capture(frame)):
        out = fp.extract_frame_with_crop(
            'fake.mp4', 0, crop={'x': 100, 'y': 50, 'width': 400, 'height': 300}
        )
    assert out.shape == (300, 400, 3)
    assert np.all(out == 200)


def test_rotated_out_of_bounds_crop_is_pulled_into_the_safe_area_not_just_frame_bounds():
    """A crop that fits the FRAME but not the rotated safe area used to leak
    black wedge pixels (the plain bounds-guard only checks the frame
    rectangle). It must now be clamped so no black enters the output."""
    W, H = 1920, 1080
    frame = np.full((H, W, 3), 200, dtype=np.uint8)
    fp = _make_processor(rotation=-3.0)

    # A full-height 9:16 crop near a side edge -- within [0, W]x[0, H] (so the
    # OLD bounds-guard alone would pass it through untouched) but NOT within
    # the -3deg-rotated safe area.
    crop = {'x': 5, 'y': 0, 'width': round(1080 * 9 / 16), 'height': 1080}
    with patch('cv2.VideoCapture', return_value=_fake_capture(frame)):
        out = fp.extract_frame_with_crop('fake.mp4', 0, crop=crop)

    assert out.size > 0
    black = np.all(out == 0, axis=2)
    assert not black.any(), f"{int(black.sum())} black pixels leaked into a rotated crop"


def test_rotated_crop_already_inside_the_safe_area_is_left_alone():
    """A crop that's already within the safe area must not be nudged further
    (idempotent clamp) -- pins that this isn't an unconditional shrink."""
    W, H = 1920, 1080
    frame = np.full((H, W, 3), 200, dtype=np.uint8)
    fp = _make_processor(rotation=-3.0)

    # Small, centered crop -- comfortably inside the safe area at 3 degrees.
    crop = {'x': 800, 'y': 400, 'width': 320, 'height': 180}
    with patch('cv2.VideoCapture', return_value=_fake_capture(frame)):
        out = fp.extract_frame_with_crop('fake.mp4', 0, crop=crop)

    assert out.shape[:2] == (180, 320)
    assert np.all(out == 200)
