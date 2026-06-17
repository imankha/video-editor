"""Tests for the centered default crop helper (T3700 P0)."""
from app.services.default_crop import default_crop_size, default_crop_keyframes


def test_predefined_9_16():
    # Mirrors the frontend DEFAULT_CROP_SIZES (205x365 for 9:16)
    assert default_crop_size(1920, 1080, "9:16") == (205, 365)


def test_predefined_16_9():
    assert default_crop_size(1920, 1080, "16:9") == (640, 360)


def test_fallback_fits_within_video():
    # Unknown ratio -> largest rectangle of that ratio fitting the video
    w, h = default_crop_size(1920, 1080, "1:1")
    assert w <= 1920 and h <= 1080
    assert w == h  # square


def test_keyframes_centered_and_static():
    kfs = default_crop_keyframes(1920, 1080, "9:16", total_frames=300)
    assert len(kfs) == 2
    start, end = kfs
    # Two identical boxes => a constant (static) crop
    assert {k: start[k] for k in ("x", "y", "width", "height")} == \
           {k: end[k] for k in ("x", "y", "width", "height")}
    # Centered: x = (1920-205)/2, y = (1080-365)/2
    assert start["x"] == round((1920 - 205) / 2)
    assert start["y"] == round((1080 - 365) / 2)
    assert start["frame"] == 0 and end["frame"] == 300


def test_keyframes_min_end_frame():
    kfs = default_crop_keyframes(1920, 1080, "9:16", total_frames=0)
    assert kfs[1]["frame"] == 1  # never a zero-length keyframe span
