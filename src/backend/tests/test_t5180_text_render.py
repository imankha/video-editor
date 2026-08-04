"""
T5180 — rich text engine: TextSpec (Pydantic) + render_text_layer (Pillow-only renderer).

Design: docs/plans/tasks/T5180-design.md (APPROVED 2026-08-04). Pins the exact contract
so the Implementor (Stage 4) builds to it, not around it:

  - `TextSpec` (+ `Position`/`Shadow`/`Stroke` + `Align`/`Animation`/`FontKey` enums) lives in
    `app.schemas`, replacing the vestigial pixel-based `TextOverlay`/`TextOverlaysData` (deleted,
    no dead imports left — see TestNoTextOverlayLeftover below).
  - `render_text_layer(spec: TextSpec, frame_w: int, frame_h: int) -> PIL.Image` lives in
    `app.services.text_render`. RGBA, transparent background, Pillow only (no ffmpeg drawtext
    anywhere — decision 5).
  - Four fonts ship in `app/assets/fonts/` (`anton`, `oswald`, `graduate`,
    `playfair`) — TTFs + licences already committed; `fonts.json` (the ONE
    manifest, §4) does not exist yet, that's Stage 4's job. `oswald`/`playfair` are
    `wght`-axis VARIABLE TTFs (no static instance ships upstream) — pinned per-render via
    `fonts.py::load_font_for_render` using the manifest's `weight` field.
  - The em-relative stroke/shadow invariant (gate decision Q1, §3): `shadow.blur` and
    `stroke.width` are fractions of the element's OWN `size`, resolved as
    `blur_px = spec.shadow.blur * spec.size * frame_h` / `stroke_px = spec.stroke.width *
    spec.size * frame_h` — NOT a fraction of frame height directly. This is the regression the
    §11 QA follow-up flags: doubling `size` must roughly double the ABSOLUTE stroke/shadow
    pixel magnitude at fixed `stroke.width`/`shadow.blur`.

RED is expected right now: `app.services.text_render` and the `TextSpec` family do not exist
yet. Every test below fails on import, which is the correct RED state for Stage 3 (test-first).
The Implementor makes this file pass without editing it.
"""

import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# --- Final import paths the Implementor must satisfy (design §3, §9) ---------------------
from app.schemas import (
    Align,
    Animation,
    FontKey,
    Position,
    Shadow,
    Stroke,
    TextSpec,
)
from app.services.text_render import render_text_layer

FONT_ASSETS_DIR = Path(__file__).resolve().parent.parent / "app" / "assets" / "fonts"

# Every font key the catalogue must cover (design §4, final keys after the static-file swap).
ALL_FONT_KEYS = [
    FontKey.ANTON,
    FontKey.OSWALD,
    FontKey.GRADUATE,
    FontKey.PLAYFAIR,
]

FRAME_W, FRAME_H = 1080, 1920
FRAME_W_LANDSCAPE, FRAME_H_LANDSCAPE = 1920, 1080


def _base_spec(**overrides) -> TextSpec:
    """A canonical spec: fill only (no shadow, no stroke) unless overridden."""
    fields = dict(
        text="MIDFIELDER  6 - 8 - 10",
        font=FontKey.ANTON,
        size=0.08,
        color="#FFD66B",
        align=Align.LEFT,
        position=Position(x=0.08, y=0.4),
        maxWidth=0.84,
        shadow=Shadow(blur=0, color="#000000", opacity=0),
        stroke=Stroke(width=0, color="#000000"),
        animation=Animation.NONE,
    )
    fields.update(overrides)
    return TextSpec(**fields)


def _alpha(img: Image.Image) -> np.ndarray:
    assert img.mode == "RGBA"
    return np.array(img)[:, :, 3]


def _tight_alpha_bbox(img: Image.Image):
    """(min_x, min_y, max_x, max_y) of non-transparent pixels, or None if fully transparent."""
    alpha = _alpha(img)
    ys, xs = np.nonzero(alpha > 0)
    if len(xs) == 0:
        return None
    return xs.min(), ys.min(), xs.max(), ys.max()


# ===========================================================================================
# Font catalogue: every font renders a correctly-sized, non-empty RGBA layer
# ===========================================================================================

class TestFontCatalogueRenders:
    @pytest.mark.parametrize("font_key", ALL_FONT_KEYS)
    def test_renders_rgba_of_correct_size(self, font_key):
        spec = _base_spec(font=font_key)
        img = render_text_layer(spec, FRAME_W, FRAME_H)
        assert img.mode == "RGBA"
        assert img.size == (FRAME_W, FRAME_H)

    @pytest.mark.parametrize("font_key", ALL_FONT_KEYS)
    def test_renders_non_empty_alpha(self, font_key):
        spec = _base_spec(font=font_key, text="X")
        img = render_text_layer(spec, FRAME_W, FRAME_H)
        assert _alpha(img).sum() > 0, f"{font_key} produced a fully transparent layer"

    def test_all_four_fonts_present_on_disk(self):
        # Sanity: the assets this test suite depends on are already sourced (per task brief).
        expected_files = {
            "anton": "Anton-Regular.ttf",
            "oswald": "Oswald-Variable.ttf",
            "graduate": "Graduate-Regular.ttf",
            "playfair": "PlayfairDisplay-Variable.ttf",
        }
        for _key, filename in expected_files.items():
            assert (FONT_ASSETS_DIR / filename).exists(), f"missing font asset {filename}"


# ===========================================================================================
# Word wrap
# ===========================================================================================

class TestWordWrap:
    def test_wraps_to_multiple_lines_when_exceeding_maxwidth(self):
        long_spec = _base_spec(
            text="THIS IS A VERY LONG PIECE OF TEXT THAT SHOULD WRAP ACROSS SEVERAL LINES",
            maxWidth=0.3,
            size=0.06,
        )
        img = render_text_layer(long_spec, FRAME_W, FRAME_H)
        bbox = _tight_alpha_bbox(img)
        assert bbox is not None
        _, min_y, _, max_y = bbox
        # Multiple wrapped lines must be visibly taller than a single line at this size.
        single_line_spec = _base_spec(text="THIS", maxWidth=0.3, size=0.06)
        single_img = render_text_layer(single_line_spec, FRAME_W, FRAME_H)
        single_bbox = _tight_alpha_bbox(single_img)
        assert single_bbox is not None
        assert (max_y - min_y) > (single_bbox[3] - single_bbox[1]) * 1.5

    def test_single_line_when_text_fits_maxwidth(self):
        spec = _base_spec(text="SHORT", maxWidth=0.9, size=0.06)
        img = render_text_layer(spec, FRAME_W, FRAME_H)
        bbox = _tight_alpha_bbox(img)
        assert bbox is not None
        height_px = bbox[3] - bbox[1]
        # A single line's height should be roughly one line-advance, not multi-line tall.
        # (loose upper bound: generous enough for descenders/ascenders, tight enough to
        # catch an accidental multi-line wrap)
        assert height_px < spec.size * FRAME_H * 1.8


# ===========================================================================================
# Alignment
# ===========================================================================================

class TestAlignment:
    def test_left_align_anchors_block_left_edge(self):
        spec = _base_spec(text="AB", align=Align.LEFT, position=Position(x=0.2, y=0.4), maxWidth=0.9)
        img = render_text_layer(spec, FRAME_W, FRAME_H)
        bbox = _tight_alpha_bbox(img)
        assert bbox is not None
        min_x = bbox[0]
        # left edge of the glyph box should be close to the anchor x (allow glyph side-bearing slack)
        assert abs(min_x - spec.position.x * FRAME_W) < 0.03 * FRAME_W

    def test_right_align_anchors_block_right_edge(self):
        spec = _base_spec(text="AB", align=Align.RIGHT, position=Position(x=0.8, y=0.4), maxWidth=0.9)
        img = render_text_layer(spec, FRAME_W, FRAME_H)
        bbox = _tight_alpha_bbox(img)
        assert bbox is not None
        max_x = bbox[2]
        assert abs(max_x - spec.position.x * FRAME_W) < 0.03 * FRAME_W

    def test_center_align_centers_block_on_anchor(self):
        spec = _base_spec(text="AB", align=Align.CENTER, position=Position(x=0.5, y=0.4), maxWidth=0.9)
        img = render_text_layer(spec, FRAME_W, FRAME_H)
        bbox = _tight_alpha_bbox(img)
        assert bbox is not None
        center_x = (bbox[0] + bbox[2]) / 2
        assert abs(center_x - spec.position.x * FRAME_W) < 0.03 * FRAME_W

    def test_left_center_right_produce_different_bboxes_for_same_text(self):
        left = render_text_layer(
            _base_spec(text="ABCD", align=Align.LEFT, position=Position(x=0.5, y=0.4)), FRAME_W, FRAME_H
        )
        center = render_text_layer(
            _base_spec(text="ABCD", align=Align.CENTER, position=Position(x=0.5, y=0.4)), FRAME_W, FRAME_H
        )
        right = render_text_layer(
            _base_spec(text="ABCD", align=Align.RIGHT, position=Position(x=0.5, y=0.4)), FRAME_W, FRAME_H
        )
        left_bbox = _tight_alpha_bbox(left)
        center_bbox = _tight_alpha_bbox(center)
        right_bbox = _tight_alpha_bbox(right)
        assert left_bbox[0] != center_bbox[0] != right_bbox[0]


# ===========================================================================================
# Shadow / stroke on/off
# ===========================================================================================

class TestShadowStroke:
    def test_shadow_on_changes_pixels_vs_fill_only(self):
        fill_only = render_text_layer(_base_spec(text="X", size=0.15), FRAME_W, FRAME_H)
        with_shadow = render_text_layer(
            _base_spec(text="X", size=0.15, shadow=Shadow(blur=0.08, color="#000000", opacity=0.55)),
            FRAME_W,
            FRAME_H,
        )
        diff = np.abs(
            np.array(with_shadow).astype(int) - np.array(fill_only).astype(int)
        )
        assert diff.sum() > 0, "shadow=on produced pixel-identical output to fill-only"

    def test_shadow_off_matches_fill_only_no_extra_pixels(self):
        fill_only = render_text_layer(_base_spec(text="X", size=0.15), FRAME_W, FRAME_H)
        explicit_zero_shadow = render_text_layer(
            _base_spec(text="X", size=0.15, shadow=Shadow(blur=0, color="#000000", opacity=0)),
            FRAME_W,
            FRAME_H,
        )
        diff = np.abs(
            np.array(explicit_zero_shadow).astype(int) - np.array(fill_only).astype(int)
        )
        assert diff.sum() == 0, "shadow magnitude=0 still drew extra pixels beyond the fill"

    def test_stroke_on_changes_pixels_vs_fill_only(self):
        fill_only = render_text_layer(_base_spec(text="X", size=0.15), FRAME_W, FRAME_H)
        with_stroke = render_text_layer(
            _base_spec(text="X", size=0.15, stroke=Stroke(width=0.06, color="#000000")),
            FRAME_W,
            FRAME_H,
        )
        diff = np.abs(
            np.array(with_stroke).astype(int) - np.array(fill_only).astype(int)
        )
        assert diff.sum() > 0, "stroke=on produced pixel-identical output to fill-only"

    def test_stroke_off_matches_fill_only_no_extra_pixels(self):
        fill_only = render_text_layer(_base_spec(text="X", size=0.15), FRAME_W, FRAME_H)
        explicit_zero_stroke = render_text_layer(
            _base_spec(text="X", size=0.15, stroke=Stroke(width=0, color="#000000")),
            FRAME_W,
            FRAME_H,
        )
        diff = np.abs(
            np.array(explicit_zero_stroke).astype(int) - np.array(fill_only).astype(int)
        )
        assert diff.sum() == 0, "stroke magnitude=0 still drew extra pixels beyond the fill"


# ===========================================================================================
# Line height from face metrics (never a hard-coded multiplier)
# ===========================================================================================

class TestLineHeightFromFaceMetrics:
    def test_line_spacing_differs_proportionally_across_fonts(self):
        """
        Two fonts with different (ascent+descent) ratios at the same nominal `size` must
        produce DIFFERENT multi-line spacing, proportional to each face's own metrics — not
        identical spacing, which would indicate a hard-coded line-height multiplier instead of
        `font.getmetrics()` (design §6 step 2).
        """
        text = "LINE ONE\nLINE TWO\nLINE THREE"
        spacings = {}
        for font_key in (FontKey.ANTON, FontKey.PLAYFAIR):
            spec = _base_spec(text=text, font=font_key, size=0.06, maxWidth=0.9)
            img = render_text_layer(spec, FRAME_W, FRAME_H)
            bbox = _tight_alpha_bbox(img)
            assert bbox is not None
            spacings[font_key] = bbox[3] - bbox[1]  # total block height across 3 lines

        # Different faces -> different ascent+descent -> different total block height.
        # (If line height were hard-coded, these would be identical.)
        assert spacings[FontKey.ANTON] != spacings[FontKey.PLAYFAIR]


# ===========================================================================================
# Resolution independence: relatively-identical output at 1080x1920 vs 1920x1080
# ===========================================================================================

class TestResolutionIndependence:
    def test_same_spec_relatively_identical_at_both_resolutions(self):
        """
        CORRECTED during Stage 4 verification: the original version of this test
        normalized bbox WIDTH by FRAME_W in both cases and failed (norm_w_p=0.457 vs
        norm_w_l=0.143) — that was a test bug, not a renderer bug. Per the frozen
        unit invariant (design §3, gate Q1), `size` is HEIGHT-relative and this spec's
        text never hits the `maxWidth` wrap boundary at either resolution, so its
        rendered pixel width is governed entirely by the height-relative font size
        (font_px = size * frame_h), not by frame_w at all. 1080x1920 and 1920x1080 are
        TRANSPOSED aspect ratios (9:16 vs 16:9, not a same-ratio zoom), so frame_w and
        frame_h swap independently — dividing a height-driven quantity by the
        (different-ratio) frame_w produces divergent numbers even though the renderer
        is behaving exactly per spec. The correct invariant: every quantity governed
        by `size` (both the block height AND, absent wrapping, the natural text width)
        stays a consistent fraction of frame HEIGHT across resolutions — verified below
        with FRAME_H / FRAME_H_LANDSCAPE as the denominator for both axes. (`maxWidth`
        wrap behavior is already covered separately by TestWordWrap, at a single
        resolution, so this test doesn't need to also exercise the width-relative axis.)
        """
        spec = _base_spec(text="RELATIVE", size=0.08, maxWidth=0.8, position=Position(x=0.1, y=0.4))

        img_portrait = render_text_layer(spec, FRAME_W, FRAME_H)
        img_landscape = render_text_layer(spec, FRAME_W_LANDSCAPE, FRAME_H_LANDSCAPE)

        bbox_p = _tight_alpha_bbox(img_portrait)
        bbox_l = _tight_alpha_bbox(img_landscape)
        assert bbox_p is not None and bbox_l is not None

        # Both axes normalized by each frame's own HEIGHT — the governing dimension
        # for a height-relative `size`, when maxWidth's wrap boundary isn't engaged.
        norm_w_p = (bbox_p[2] - bbox_p[0]) / FRAME_H
        norm_h_p = (bbox_p[3] - bbox_p[1]) / FRAME_H
        norm_w_l = (bbox_l[2] - bbox_l[0]) / FRAME_H_LANDSCAPE
        norm_h_l = (bbox_l[3] - bbox_l[1]) / FRAME_H_LANDSCAPE

        assert abs(norm_w_p - norm_w_l) < 0.02, "normalized width diverges across resolutions"
        assert abs(norm_h_p - norm_h_l) < 0.02, "normalized height diverges across resolutions"


# ===========================================================================================
# Cache: identical (spec, w, h) is a cache hit
# ===========================================================================================

class TestCache:
    def test_identical_spec_and_dims_is_cache_hit(self):
        """
        Design §6: cache key = sha256 of canonical (sorted-key) TextSpec JSON + "{w}x{h}".
        Bounded LRU dict, process-local. We can't rely on object identity being part of the
        PUBLIC contract, so this test spies on the underlying render work via a monkeypatch-free
        approach: call twice and assert the SECOND call is dramatically cheaper is fragile, so
        instead assert the documented, observable contract -- identical output AND (if exposed)
        a cache-stats/introspection hook. If no stats hook exists, this at minimum locks image
        equality, which the Implementor should strengthen with a real hit-counter per §6.
        """
        spec = _base_spec(text="CACHE ME")
        img1 = render_text_layer(spec, FRAME_W, FRAME_H)
        img2 = render_text_layer(spec, FRAME_W, FRAME_H)

        # Pixel-identical (same content) is necessary regardless of caching mechanism.
        assert np.array_equal(np.array(img1), np.array(img2))

        # Design §6 names an explicit cache structure (bounded LRU dict keyed by a content
        # hash). If the Implementor exposes it for introspection (e.g.
        # `app.services.text_render._LAYER_CACHE` or a `render_text_layer.cache_info()`-style
        # hook), assert an actual hit. This is a soft check: only enforced if the hook exists,
        # so it doesn't over-constrain an implementation detail not in the public signature.
        import app.services.text_render as text_render_module

        cache_obj = getattr(text_render_module, "_LAYER_CACHE", None)
        if cache_obj is not None:
            # Implementor's exact hashing may differ; this only checks SOMETHING got cached.
            assert len(cache_obj) >= 1, "expected the LRU cache to hold at least one entry"

    def test_different_dims_are_different_cache_entries(self):
        spec = _base_spec(text="DIMS DIFFER")
        img_a = render_text_layer(spec, FRAME_W, FRAME_H)
        img_b = render_text_layer(spec, FRAME_W_LANDSCAPE, FRAME_H_LANDSCAPE)
        assert img_a.size != img_b.size


# ===========================================================================================
# Unknown font key fails loudly
# ===========================================================================================

class TestUnknownFontFailsLoudly:
    def test_unregistered_font_key_rejected_at_textspec_construction(self):
        with pytest.raises(ValidationError):
            _base_spec(font="not-a-real-font-key")

    def test_font_key_enum_has_no_silent_default(self):
        # FontKey must be a real Enum with no implicit fallback member; constructing TextSpec
        # without a font at all must raise (no silent default font).
        with pytest.raises(ValidationError):
            TextSpec(
                text="x",
                size=0.08,
                color="#FFFFFF",
                align=Align.LEFT,
                position=Position(x=0.1, y=0.1),
                maxWidth=0.8,
            )


# ===========================================================================================
# Em-relative stroke/shadow invariant (gate decision Q1, §11 QA follow-up regression)
# ===========================================================================================

class TestEmRelativeStrokeShadowInvariant:
    def _stroke_extent_px(self, spec) -> int:
        """Rightmost extent of a single glyph's alpha footprint (stroke pushes it outward)."""
        img = render_text_layer(spec, FRAME_W, FRAME_H)
        bbox = _tight_alpha_bbox(img)
        assert bbox is not None
        return bbox[2] - bbox[0]

    def test_doubling_size_roughly_doubles_absolute_stroke_pixel_magnitude(self):
        """
        Regression the §11 QA follow-up flags: stroke.width/shadow.blur are fractions of the
        element's OWN `size` (em-relative), so at a FIXED stroke.width, doubling `size` must
        roughly double the resolved absolute stroke_px = stroke.width * size * frame_h — NOT
        stay fixed (which would indicate an accidental frame-relative regression).
        """
        small = _base_spec(
            text="I", size=0.04, stroke=Stroke(width=0.1, color="#FF0000"), color="#FFFFFF"
        )
        large = _base_spec(
            text="I", size=0.08, stroke=Stroke(width=0.1, color="#FF0000"), color="#FFFFFF"
        )

        small_width = self._stroke_extent_px(small)
        large_width = self._stroke_extent_px(large)

        # The glyph itself scales with size too, so isolate the stroke's marginal contribution
        # by comparing a stroked vs unstroked render at each size and taking the delta.
        small_fill = self._stroke_extent_px(
            _base_spec(text="I", size=0.04, stroke=Stroke(width=0, color="#FF0000"), color="#FFFFFF")
        )
        large_fill = self._stroke_extent_px(
            _base_spec(text="I", size=0.08, stroke=Stroke(width=0, color="#FF0000"), color="#FFFFFF")
        )

        small_stroke_delta = small_width - small_fill
        large_stroke_delta = large_width - large_fill

        assert small_stroke_delta > 0, "stroke did not widen the glyph bbox at all"
        assert large_stroke_delta > 0, "stroke did not widen the glyph bbox at all"

        # Expect roughly a 2x relationship (size doubled), generous tolerance for glyph/AA noise.
        ratio = large_stroke_delta / small_stroke_delta
        assert 1.5 <= ratio <= 2.7, (
            f"stroke pixel delta did not scale ~2x with size (got ratio={ratio:.2f}); "
            "stroke.width may be resolving as frame-relative instead of em-relative (gate Q1)"
        )

    def test_doubling_size_roughly_doubles_absolute_shadow_blur_magnitude(self):
        """Same invariant for shadow.blur (em-relative, fraction of `size`)."""

        def shadow_halo_px(size: float) -> int:
            spec = _base_spec(
                text="I",
                size=size,
                shadow=Shadow(blur=0.15, color="#0000FF", opacity=1.0),
                stroke=Stroke(width=0, color="#000000"),
            )
            fill_spec = _base_spec(
                text="I", size=size, shadow=Shadow(blur=0, color="#0000FF", opacity=0)
            )
            shadow_img = render_text_layer(spec, FRAME_W, FRAME_H)
            fill_img = render_text_layer(fill_spec, FRAME_W, FRAME_H)
            shadow_bbox = _tight_alpha_bbox(shadow_img)
            fill_bbox = _tight_alpha_bbox(fill_img)
            assert shadow_bbox is not None and fill_bbox is not None
            # Halo = how far the shadow-inclusive bbox extends beyond the fill-only bbox.
            return (shadow_bbox[2] - shadow_bbox[0]) - (fill_bbox[2] - fill_bbox[0])

        small_halo = shadow_halo_px(0.04)
        large_halo = shadow_halo_px(0.08)

        assert small_halo > 0 and large_halo > 0, "shadow blur produced no halo at all"
        ratio = large_halo / small_halo
        assert 1.4 <= ratio <= 2.8, (
            f"shadow blur halo did not scale ~2x with size (got ratio={ratio:.2f}); "
            "shadow.blur may be resolving as frame-relative instead of em-relative (gate Q1)"
        )


# ===========================================================================================
# TextSpec Pydantic validation
# ===========================================================================================

class TestTextSpecValidation:
    def test_valid_spec_constructs(self):
        spec = _base_spec()
        assert spec.font == FontKey.ANTON

    def test_rejects_bad_hex_color(self):
        with pytest.raises(ValidationError):
            _base_spec(color="not-a-hex-color")

    def test_rejects_hex_without_hash(self):
        with pytest.raises(ValidationError):
            _base_spec(color="FFD66B")

    @pytest.mark.parametrize("bad_size", [0, -0.1, 0.51, 1.0])
    def test_size_out_of_range_raises(self, bad_size):
        with pytest.raises(ValidationError):
            _base_spec(size=bad_size)

    @pytest.mark.parametrize("bad_max_width", [0, -0.1, 1.01])
    def test_maxwidth_out_of_range_raises(self, bad_max_width):
        with pytest.raises(ValidationError):
            _base_spec(maxWidth=bad_max_width)

    @pytest.mark.parametrize("bad_xy", [-0.01, 1.01])
    def test_position_out_of_range_raises(self, bad_xy):
        with pytest.raises(ValidationError):
            _base_spec(position=Position(x=bad_xy, y=0.5))
        with pytest.raises(ValidationError):
            _base_spec(position=Position(x=0.5, y=bad_xy))

    @pytest.mark.parametrize("bad_blur", [-0.01, 0.51])
    def test_shadow_blur_out_of_range_raises(self, bad_blur):
        with pytest.raises(ValidationError):
            _base_spec(shadow=Shadow(blur=bad_blur, color="#000000", opacity=0.5))

    @pytest.mark.parametrize("bad_opacity", [-0.01, 1.01])
    def test_shadow_opacity_out_of_range_raises(self, bad_opacity):
        with pytest.raises(ValidationError):
            _base_spec(shadow=Shadow(blur=0.1, color="#000000", opacity=bad_opacity))

    @pytest.mark.parametrize("bad_width", [-0.01, 0.16])
    def test_stroke_width_out_of_range_raises(self, bad_width):
        with pytest.raises(ValidationError):
            _base_spec(stroke=Stroke(width=bad_width, color="#000000"))

    def test_out_of_range_values_raise_not_silently_clamp(self):
        # Explicit regression for the "no silent fallback/clamp for internal data" rule
        # (CLAUDE.md coding principles) -- an out-of-range size must NOT be silently coerced
        # into range; it must raise.
        with pytest.raises(ValidationError):
            _base_spec(size=999)

    def test_default_shadow_is_zero_magnitude_no_shadow(self):
        spec = TextSpec(
            text="x",
            font=FontKey.ANTON,
            size=0.08,
            color="#FFFFFF",
            align=Align.LEFT,
            position=Position(x=0.1, y=0.1),
            maxWidth=0.8,
        )
        assert spec.shadow.blur == 0
        assert spec.shadow.opacity == 0

    def test_default_stroke_is_zero_magnitude_no_stroke(self):
        spec = TextSpec(
            text="x",
            font=FontKey.ANTON,
            size=0.08,
            color="#FFFFFF",
            align=Align.LEFT,
            position=Position(x=0.1, y=0.1),
            maxWidth=0.8,
        )
        assert spec.stroke.width == 0

    def test_default_align_is_left(self):
        spec = TextSpec(
            text="x",
            font=FontKey.ANTON,
            size=0.08,
            color="#FFFFFF",
            position=Position(x=0.1, y=0.1),
            maxWidth=0.8,
        )
        assert spec.align == Align.LEFT

    def test_default_animation_is_none(self):
        spec = TextSpec(
            text="x",
            font=FontKey.ANTON,
            size=0.08,
            color="#FFFFFF",
            position=Position(x=0.1, y=0.1),
            maxWidth=0.8,
        )
        assert spec.animation == Animation.NONE


# ===========================================================================================
# TextOverlay / TextOverlaysData deletion (design §9 refactor prerequisite)
# ===========================================================================================

class TestNoTextOverlayLeftover:
    """
    Design §9: `TextOverlay`/`TextOverlaysData` (schemas.py:273-306) are DELETED, replaced by
    TextSpec — not extended. This is a grep-based test (house style precedent: this repo's
    other T-suites assert absence of legacy code paths via direct import/attribute checks,
    e.g. test_t3950_branded_outro.py's "no DB/persistence import" check). Currently RED because
    the module still defines them; goes GREEN when the Implementor deletes them.
    """

    def test_text_overlay_no_longer_exported_from_schemas(self):
        import app.schemas as schemas_module

        assert not hasattr(schemas_module, "TextOverlay"), (
            "TextOverlay must be deleted per design §9 (replaced by TextSpec), not left behind"
        )
        assert not hasattr(schemas_module, "TextOverlaysData"), (
            "TextOverlaysData must be deleted per design §9 (replaced by TextSpec), not left behind"
        )

    def test_no_source_file_imports_text_overlay(self):
        backend_app_dir = Path(__file__).resolve().parent.parent / "app"
        offenders = []
        for py_file in backend_app_dir.rglob("*.py"):
            text = py_file.read_text(encoding="utf-8", errors="ignore")
            if "TextOverlay" in text and py_file.name != "schemas.py":
                offenders.append(str(py_file))
        assert not offenders, f"dead TextOverlay references remain in: {offenders}"
