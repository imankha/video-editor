"""
T5640 — characterization tests pinning the rotation render primitive.

The whole preview<->export contract rests on ONE primitive being consistent
across cv2 / ffmpeg / CSS: rotate the full frame about its center (output kept at
source W*H) THEN slice the axis-aligned crop. These tests pin:

  1. theta == 0 is BYTE-IDENTICAL to a plain slice (no regression — the theta=0
     fast path must never touch pixels). This is the "desktop crop drag / export
     unchanged when rotation=0" acceptance guard.
  2. For a known (theta=-3, safe-area-clamped crop) the output has NO pure-black
     pixels (the safe-area clamp holds -> no black corners bleed into the crop)
     and a marker centroid pins where the content lands, so a future cv2/ffmpeg
     refactor cannot silently drift the geometry.
  3. The Python safe-area mirror matches the closed-form expectations that the JS
     SSOT (rotationSafeArea.js) also encodes.
"""

import math

import numpy as np

from app.modal_functions.video_processing import rotate_then_crop
from app.services.rotation_safe_area import (
    clamp_crop_to_safe_area,
    max_axis_aligned_in_rotated,
    safe_area_for_aspect,
)


def _frame(w=1920, h=1080, value=180):
    f = np.full((h, w, 3), value, dtype=np.uint8)
    return f


def test_theta0_is_byte_identical_to_plain_slice():
    """rotation=0 must be the byte-identical fast path (no warp)."""
    f = _frame()
    # Non-trivial noise so an accidental warp would show up.
    rng = np.random.default_rng(1234)
    f[:] = rng.integers(0, 255, size=f.shape, dtype=np.uint8)

    x, y, w, h = 300, 200, 810, 720
    out = rotate_then_crop(f, 0, x, y, w, h)
    expected = f[y:y + h, x:x + w]

    assert out.shape == (h, w, 3)
    assert np.array_equal(out, expected), "theta=0 must not touch pixels"


def test_clamped_crop_has_no_black_corners_at_minus3_deg():
    """A safe-area-clamped crop over a -3 deg rotated frame contains NO pure-black
    pixel — the black wedges the rotation exposes fall outside the clamped crop."""
    W, H = 1920, 1080
    theta = -3.0
    # Interior content is a constant non-black value so any warp border black is
    # detectable; leave a 0-value nowhere in the interior.
    f = _frame(W, H, value=200)

    # Target 9:16 reel aspect. Start from an oversize centered crop, then clamp.
    r = 9 / 16
    oversize = {"x": 400, "y": 0, "width": 1080 * r, "height": 1080}
    clamped = clamp_crop_to_safe_area(oversize, W, H, theta, r)

    x = int(clamped["x"])
    y = int(clamped["y"])
    w = int(clamped["width"])
    h = int(clamped["height"])
    # Inset by 1px on each side to avoid warp edge-interpolation half-pixels at
    # the exact safe-area boundary (the clamp is exact in float; the integer
    # slice + Lanczos edge can dip one sub-pixel row/col).
    out = rotate_then_crop(f, theta, x + 1, y + 1, max(1, w - 2), max(1, h - 2))

    # No pure-black pixel anywhere in the clamped crop.
    black = np.all(out == 0, axis=2)
    assert not black.any(), f"{int(black.sum())} black pixels leaked into the clamped crop"


def test_marker_centroid_pins_rotation_geometry():
    """A bright marker at the frame center stays at the crop center after a
    center-rotation + centered crop — pins the 'rotate about center' invariant
    (a wrong center or sign would shift the centroid)."""
    W, H = 1920, 1080
    theta = -3.0
    f = _frame(W, H, value=60)
    # 40px white square centered on the frame center.
    cx, cy = W // 2, H // 2
    f[cy - 20:cy + 20, cx - 20:cx + 20] = 255

    # Centered crop of the same center.
    w, h = 810, 720
    x = cx - w // 2
    y = cy - h // 2
    out = rotate_then_crop(f, theta, x, y, w, h)

    bright = np.all(out >= 250, axis=2)
    assert bright.any(), "marker vanished"
    ys, xs = np.nonzero(bright)
    got_cx = xs.mean()
    got_cy = ys.mean()
    # The marker centroid should land at the crop center within 1px (rotation is
    # about the frame center == the crop center here, so the center is fixed).
    assert abs(got_cx - w / 2) <= 1.0, f"centroid x drifted: {got_cx} vs {w / 2}"
    assert abs(got_cy - h / 2) <= 1.0, f"centroid y drifted: {got_cy} vs {h / 2}"


def test_safe_area_zero_theta_is_full_frame():
    assert max_axis_aligned_in_rotated(1920, 1080, 0) == (1920, 1080)


def test_clamp_zero_theta_is_identity():
    crop = {"x": 100, "y": 50, "width": 400, "height": 300}
    out = clamp_crop_to_safe_area(crop, 1920, 1080, 0, 4 / 3)
    assert out == {"x": 100, "y": 50, "width": 400, "height": 300}


def test_safe_area_shrinks_and_preserves_aspect():
    """A rotated frame's inscribed aspect box is strictly smaller than the frame
    and keeps the target aspect exactly."""
    W, H = 1920, 1080
    r = 9 / 16
    S = safe_area_for_aspect(W, H, 8.0, r)
    assert S["w_safe"] < W and S["h_safe"] < H
    assert math.isclose(S["w_safe"] / S["h_safe"], r, rel_tol=1e-9)
    # Centered.
    assert math.isclose(S["x0"], (W - S["w_safe"]) / 2, rel_tol=1e-9)
    assert math.isclose(S["y0"], (H - S["h_safe"]) / 2, rel_tol=1e-9)


def test_clamp_recenters_and_locks_aspect():
    W, H = 1920, 1080
    r = 9 / 16
    theta = 6.0
    # Oversize crop pushed to a corner; clamp must shrink + pull inside the safe
    # area and keep aspect r.
    crop = {"x": 1500, "y": 800, "width": 900, "height": 1600}
    out = clamp_crop_to_safe_area(crop, W, H, theta, r)
    assert math.isclose(out["width"] / out["height"], r, rel_tol=1e-9)
    S = safe_area_for_aspect(W, H, theta, r)
    assert out["x"] >= S["x0"] - 1e-6
    assert out["y"] >= S["y0"] - 1e-6
    assert out["x"] + out["width"] <= S["x0"] + S["w_safe"] + 1e-6
    assert out["y"] + out["height"] <= S["y0"] + S["h_safe"] + 1e-6
