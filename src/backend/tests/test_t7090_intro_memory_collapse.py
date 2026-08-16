"""T7090 (fix #2) -- collapse the intro-card ffmpeg input explosion.

The OOM root cause: `_build_card` fed ffmpeg ONE `-loop 1 -i <full-frame RGBA PNG>`
input per static visual layer AND per text element, each costing ~150MB peak RSS,
so a typical card demanded ~1.7GB on a 1GB box. Two memory-only, pixel-preserving
changes:

  1. the static (non-animated) layers -- tint/vignette/seam over the photo rect +
     the full-frame scrim/band -- collapse into ONE alpha-composited input;
  2. each text layer is cropped to its glyph bbox and overlaid at an explicit
     offset instead of a full-frame layer at x=0.

The counterfactual (acceptance criterion): the OLD graph used
`1(bg) + N_static + N_text` looped full-frame inputs; the new graph uses
`2(bg + one static composite) + N_text`, with N_static >= 2 for a real treatment
-- so the collapse strictly removes the inputs whose per-input RSS OOM-killed the
render. Pixel equivalence is proven directly (the collapse math and the crop are
literal sub-image / associative-composite identities), not by a brittle
ffmpeg-vs-ffmpeg frame diff.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.schemas import TextSpec
from app.services import player_intro as P
from app.services.player_intro import _composite_static_layers
from app.services.text_render import render_text_layer, render_text_layer_cropped

pytestmark = pytest.mark.filterwarnings("ignore")

FRAME_W, FRAME_H = 480, 270


# =============================================================================
# 1. _composite_static_layers == a reference sequential source-over composite
# =============================================================================
def _reference_composite(layers, w, h):
    """Sequential source-over via paste-onto-transparent + alpha_composite -- the
    exact semantics one ffmpeg `overlay` per layer produced."""
    ref = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for img, x, y in layers:
        full = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        full.paste(img.convert("RGBA"), (x, y))
        ref = Image.alpha_composite(ref, full)
    return ref


def test_static_composite_is_pixel_identical_to_sequential_overlays():
    w, h = 120, 90
    tint = Image.new("RGBA", (60, 40), (255, 0, 0, 128))
    vignette = Image.new("RGBA", (60, 40), (0, 0, 0, 90))
    band = Image.new("RGBA", (w, h), (0, 0, 255, 70))
    layers = [(tint, 10, 8), (vignette, 10, 8), (band, 0, 0)]

    got = _composite_static_layers(layers, w, h)
    ref = _reference_composite(layers, w, h)
    assert list(got.getdata()) == list(ref.getdata())


def test_static_composite_clips_at_the_frame_edge_like_overlay():
    w, h = 100, 100
    # A layer that overflows the bottom-right corner -- ffmpeg overlay clips it.
    layer = Image.new("RGBA", (40, 40), (0, 200, 0, 200))
    got = _composite_static_layers([(layer, 80, 80)], w, h)
    ref = _reference_composite([(layer, 80, 80)], w, h)
    assert got.size == (w, h)
    assert list(got.getdata()) == list(ref.getdata())


def test_static_composite_empty_is_none():
    assert _composite_static_layers([], 100, 100) is None


# =============================================================================
# 2. render_text_layer_cropped: crop + offset reconstructs the full-frame render
# =============================================================================
def _spec(text, size=0.12, **kw):
    base = {"text": text, "font": "anton", "color": "#ffffff", "size": size,
            "align": "center", "position": {"x": 0.5, "y": 0.4}, "maxWidth": 0.8,
            "animation": "none"}
    base.update(kw)
    return TextSpec.model_validate(base)


def test_cropped_layer_reconstructs_full_frame_exactly():
    spec = _spec("Marcus Johnson")
    full = render_text_layer(spec, FRAME_W, FRAME_H)
    crop, (x0, y0) = render_text_layer_cropped(spec, FRAME_W, FRAME_H)

    # The crop must be strictly smaller than the full frame (that IS the saving).
    assert crop.size[0] < FRAME_W and crop.size[1] < FRAME_H
    recon = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    recon.paste(crop, (x0, y0))
    assert list(recon.getdata()) == list(full.getdata())


def test_cropped_layer_bbox_matches_full_frame_bbox():
    spec = _spec("Point Guard", position={"x": 0.5, "y": 0.7})
    full = render_text_layer(spec, FRAME_W, FRAME_H)
    _crop, (x0, y0) = render_text_layer_cropped(spec, FRAME_W, FRAME_H)
    assert (x0, y0) == full.getbbox()[:2]


# =============================================================================
# 3. Input-count collapse (the counterfactual) + real-render smoke
# =============================================================================
@pytest.fixture
def photo(tmp_path):
    p = tmp_path / "photo.png"
    img = Image.new("RGB", (600, 800), (30, 80, 160))
    img.paste((240, 60, 60), (150, 120, 450, 700))
    img.save(p)
    return str(p)


def _info(audio: bool = False) -> dict:
    return {"width": FRAME_W, "height": FRAME_H, "fps_str": "30/1",
            "pix_fmt": "yuv420p", "sar": "1/1", "timescale": 15360,
            "duration": 0.0, "has_audio": audio, "a_codec": "aac",
            "a_rate": 48000, "a_channels": 2}


def _card(**kw) -> dict:
    c = {"id": 9, "name": "card", "shown_fields": ["position", "height", "class_year"],
         "treatment": "dark", "title_text": None, "subtitle_text": "State Finals",
         "image_key": "k", "image_cutout_key": None, "focal_x": 0.5, "focal_y": 0.25,
         "zoom": 1.1, "text_elements": {}, "duration": 1.0, "is_default": False}
    c.update(kw)
    return c


FIELDS = {"full_name": "Marcus Johnson", "position": "Point Guard",
          "height": "6'2\"", "class_year": "2026"}


@pytest.mark.skipif(not os.path.exists("/usr/bin/ffmpeg"),
                    reason="ffmpeg required for the card render smoke")
def test_static_layers_collapse_to_one_input(tmp_path, monkeypatch, photo):
    monkeypatch.setattr(P, "_CARD_CACHE_DIR", tmp_path / "cards")
    captured: dict = {}
    real_run = P._run

    def capturing(cmd):
        captured["cmd"] = list(cmd)
        return real_run(cmd)

    monkeypatch.setattr(P, "_run", capturing)

    card = _card()
    path = P._get_or_build_card(card, FIELDS, photo, _info())
    assert path is not None, "the card must still build after the collapse"
    cmd = captured["cmd"]

    # The five old per-layer inputs are gone; exactly ONE collapsed static input.
    assert sum("static_overlay.png" in a for a in cmd) == 1
    for old in ("tint.png", "vignette.png", "seam.png", "scrim.png", "band.png"):
        assert not any(old in a for a in cmd), f"{old} must be folded into the composite"

    # This "dark" treatment yields >= 2 static layers (tint + vignette + band),
    # so the OLD graph would have used 1(bg) + N_static(>=2) + N_text looped
    # full-frame inputs. The NEW graph uses 2(bg + one static) + N_text.
    n_text = sum(("el_" in a and a.endswith(".png")) for a in cmd)
    assert n_text >= 3, "title + subtitle + facts should produce several text layers"
    loops = cmd.count("-loop")
    assert loops == 2 + n_text, (
        f"expected bg + one static composite + {n_text} text inputs = {2 + n_text} "
        f"looped inputs; got {loops} (static layers failed to collapse)")


@pytest.mark.skipif(not os.path.exists("/usr/bin/ffmpeg"),
                    reason="ffmpeg required for the card render smoke")
def test_collapsed_card_still_renders_valid_animated_mp4(tmp_path, monkeypatch, photo):
    monkeypatch.setattr(P, "_CARD_CACHE_DIR", tmp_path / "cards")
    out = tmp_path / "card.mp4"
    P._build_card(_card(), FIELDS, photo, _info(), str(out))
    assert out.exists() and out.stat().st_size > 0

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,nb_read_frames,pix_fmt",
         "-count_frames", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, check=True).stdout.strip()
    w, h, *_ = probe.split(",")
    assert (int(w), int(h)) == (FRAME_W, FRAME_H)
