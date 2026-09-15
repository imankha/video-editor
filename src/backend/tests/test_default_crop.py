"""Tests for the centered default crop helper (T3700 P0)."""
import re
from pathlib import Path

from app.services.default_crop import (
    DEFAULT_CROP_SIZES,
    default_crop_size,
    default_crop_keyframes,
)


def test_predefined_9_16():
    # Mirrors the frontend DEFAULT_CROP_SIZES (410x730 for 9:16 since T10150).
    assert default_crop_size(1920, 1080, "9:16") == (410, 730)


def test_predefined_16_9():
    # Mirrors the frontend DEFAULT_CROP_SIZES (1280x720 for 16:9 since T10150).
    assert default_crop_size(1920, 1080, "16:9") == (1280, 720)


def test_predefined_resolves_without_source_dims():
    # The two product ratios are source-independent, so they must resolve even
    # when the source dims are unknown (legacy game_videos rows) — the box is not
    # clamped away just because we can't measure the frame.
    assert default_crop_size(None, None, "9:16") == (410, 730)
    assert default_crop_size(0, 0, "16:9") == (1280, 720)


def test_predefined_falls_back_when_source_too_small():
    # T10150: the enlarged defaults (410x730 / 1280x720) can exceed a tiny source.
    # Rather than return an overflowing box, fit the largest rectangle of that ratio
    # inside the source so the default is always a valid in-bounds crop.
    w, h = default_crop_size(320, 240, "16:9")  # 1280x720 does not fit
    assert w <= 320 and h <= 240
    assert abs((w / h) - (16 / 9)) < 0.02  # still 16:9

    w, h = default_crop_size(200, 400, "9:16")  # 410x730 does not fit
    assert w <= 200 and h <= 400
    assert abs((w / h) - (9 / 16)) < 0.02  # still 9:16


def test_fallback_fits_within_video():
    # Unknown ratio -> largest rectangle of that ratio fitting the video
    w, h = default_crop_size(1920, 1080, "1:1")
    assert w <= 1920 and h <= 1080
    assert w == h  # square


def test_frontend_backend_parity():
    """DEFAULT_CROP_SIZES must never drift between the two mirrored constants.

    Parses the frontend constant straight out of useCrop.js and asserts it matches
    the backend dict exactly. This is the drift guard the two "MUST stay mirrored"
    comments refer to (T10150 AC): a change to one side without the other fails here.
    """
    js_path = (
        Path(__file__).resolve().parents[3]
        / "src" / "frontend" / "src" / "modes" / "focus" / "hooks" / "useCrop.js"
    )
    source = js_path.read_text(encoding="utf-8")
    block = re.search(
        r"const DEFAULT_CROP_SIZES\s*=\s*\{(.*?)\};", source, re.DOTALL
    )
    assert block, "DEFAULT_CROP_SIZES literal not found in useCrop.js"

    frontend = {
        ratio: (int(w), int(h))
        for ratio, w, h in re.findall(
            r"'([\d:]+)'\s*:\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)\s*\}",
            block.group(1),
        )
    }
    # Guard the inner regex too: if a future reformat of useCrop.js stops the
    # entry regex from matching, fail with a clear "parsed 0 ratios" signal
    # rather than silently comparing an empty dict.
    assert len(frontend) == len(DEFAULT_CROP_SIZES), (
        f"parsed {len(frontend)} ratios from useCrop.js "
        f"({sorted(frontend)}); expected {sorted(DEFAULT_CROP_SIZES)} — "
        "the entry regex likely no longer matches the JS formatting"
    )
    assert frontend == {k: tuple(v) for k, v in DEFAULT_CROP_SIZES.items()}


def test_keyframes_centered_and_static():
    kfs = default_crop_keyframes(1920, 1080, "9:16", total_frames=300)
    assert len(kfs) == 2
    start, end = kfs
    # Two identical boxes => a constant (static) crop
    assert {k: start[k] for k in ("x", "y", "width", "height")} == \
           {k: end[k] for k in ("x", "y", "width", "height")}
    # Centered: x = (1920-410)/2, y = (1080-730)/2
    assert start["x"] == round((1920 - 410) / 2)
    assert start["y"] == round((1080 - 730) / 2)
    assert start["frame"] == 0 and end["frame"] == 300


def test_keyframes_min_end_frame():
    kfs = default_crop_keyframes(1920, 1080, "9:16", total_frames=0)
    assert kfs[1]["frame"] == 1  # never a zero-length keyframe span
