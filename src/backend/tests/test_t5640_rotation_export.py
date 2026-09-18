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

2026-09-18 data-loss fix: `rotate_then_crop` used to TRUST its caller to have
already clamped x/y/w/h to the safe area (the caller was the frontend, which
clamped and PERSISTED the clamp into the stored crop keyframes -- destructive,
irreversible, and the actual cause of the reported data loss; see
useCrop.setRotation's docstring on the frontend). Crop keyframes now store the
user's true framing verbatim; `rotate_then_crop` clamps INTERNALLY instead, so
it is the render path's own guarantee against black wedges, not a trust
contract with a caller that may hand it out-of-bounds coordinates. Section 4
below pins that internal clamp directly; Section 5 pins byte-for-byte parity
between video_processing.py's Modal-inline copy of the clamp
(`_clamp_crop_to_safe_area`, needed because the Modal image can't import
`app`) and the canonical `app.services.rotation_safe_area` module.
"""

import math

import numpy as np
import pytest

from app.modal_functions.video_processing import (
    _clamp_crop_to_safe_area as modal_clamp,
)
from app.modal_functions.video_processing import rotate_then_crop
from app.services.rotation_safe_area import (
    ROTATION_EPSILON,
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


def test_denormal_theta_is_identity_passthrough():
    """T6170 — parity with the JS twin: a denormal rotation (FP residue from the
    dial nudge, e.g. 0.1+0.1+0.1-0.1-0.1-0.1) must NOT engage the clamp. The exact
    staging value 2.7755575615628914e-17 pinned the crop x from 660 to 656.25 in
    the JS SSOT before the epsilon guard; this mirror must agree."""
    denormal = 0.1 + 0.1 + 0.1 - 0.1 - 0.1 - 0.1
    assert denormal != 0
    assert denormal < ROTATION_EPSILON
    crop = {"x": 660, "y": 0, "width": 607.5, "height": 1080}
    out = clamp_crop_to_safe_area(crop, 1920, 1080, denormal, 9 / 16)
    assert out == crop  # identity, same as theta=0
    assert out == clamp_crop_to_safe_area(crop, 1920, 1080, 0, 9 / 16)


def test_real_small_rotation_still_clamps():
    """The epsilon must not disable the feature: 0.1 degrees (the finest real dial
    step) is above ROTATION_EPSILON and MUST still pull an oversize crop in."""
    assert ROTATION_EPSILON < 0.1
    crop = {"x": 660, "y": 0, "width": 607.5, "height": 1080}
    out = clamp_crop_to_safe_area(crop, 1920, 1080, 0.1, 9 / 16)
    assert out["x"] < crop["x"]
    assert out != crop


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


def test_rotate_then_crop_clamps_an_out_of_bounds_crop_itself():
    """2026-09-18 data-loss fix: `rotate_then_crop` no longer trusts its caller
    to have pre-clamped x/y/w/h -- it must clamp INTERNALLY, since crop
    keyframes now store the user's true (possibly out-of-safe-area) framing
    verbatim. Feed it a crop that is NOT pre-clamped and assert it still slices
    without going out of the frame's bounds and still contains no black wedge."""
    W, H = 1920, 1080
    theta = -3.0
    f = _frame(W, H, value=200)

    # The SAME oversize, un-clamped crop the other black-corner test clamps
    # manually before calling rotate_then_crop -- this time handed straight
    # through, unclamped, to prove the primitive clamps it itself.
    r = 9 / 16
    x, y, w, h = 400, 0, round(1080 * r), 1080

    out = rotate_then_crop(f, theta, x, y, w, h)

    assert out.size > 0
    black = np.all(out == 0, axis=2)
    assert not black.any(), f"{int(black.sum())} black pixels leaked into an unclamped crop"


class TestModalInlineClampParity:
    """The Modal image can't import app.services, so video_processing.py inlines
    a copy of clamp_crop_to_safe_area (`_clamp_crop_to_safe_area`). It must match
    the canonical module for every input, integer-rounding aside (the inline copy
    rounds to whole pixels for the cv2 slice; the canonical module stays float).

    The inline copy derives r from the crop's OWN w/h (no separate r parameter —
    matching how both real callers invoke the canonical function, always passing
    r=width/height of the SAME crop), so every case here keeps w/h consistent
    with the parametrized r — an (x, y, w, h) whose aspect does not match r is
    not a shape either caller ever actually produces.
    """

    @pytest.mark.parametrize(
        "x,y,w,h,frame_w,frame_h,theta,r",
        [
            (100, 50, 400, 300, 1920, 1080, 0, 4 / 3),  # identity
            (660, 0, 607.5, 1080, 1920, 1080, 0.1, 9 / 16),  # finest real dial step
            (400, 0, 1080 * 9 / 16, 1080, 1920, 1080, -3.0, 9 / 16),  # T5640 case
            (1500, 800, 900, 1600, 1920, 1080, 6.0, 9 / 16),  # corner, aspect lock
            (0, 0, 1080 * 9 / 16, 1080, 1920, 1080, 15.0, 9 / 16),  # near/at MAX travel
        ],
    )
    def test_matches_canonical(self, x, y, w, h, frame_w, frame_h, theta, r):
        canonical = clamp_crop_to_safe_area({"x": x, "y": y, "width": w, "height": h}, frame_w, frame_h, theta, r)
        inline = modal_clamp(x, y, w, h, frame_w, frame_h, theta)
        assert inline == (
            round(canonical["x"]),
            round(canonical["y"]),
            round(canonical["width"]),
            round(canonical["height"]),
        )
