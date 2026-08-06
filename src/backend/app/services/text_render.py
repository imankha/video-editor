"""
T5180 rich text engine — THE ONE backend renderer.

`render_text_layer(spec: TextSpec, frame_w: int, frame_h: int) -> PIL.Image`
draws a TextSpec into a transparent RGBA layer, Pillow only. No ffmpeg
`drawtext` anywhere (EPIC decision 5) and no headless browser — this module
never touches ffmpeg, video, R2 or the DB; callers (T5210 card renderer,
T5225 Overlay burn-in) own compositing the returned layer onto video frames.

Design: docs/plans/tasks/T5180-design.md §6. The unit invariant (frame- vs
em-relative fields) is documented ONCE in app/schemas.py above TextSpec —
this module just implements the resolution formulas from that invariant.
"""

import hashlib
import json
import logging
from collections import OrderedDict

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.schemas import Align, TextSpec
from app.services.fonts import load_font_for_render

logger = logging.getLogger(__name__)

# Bounded LRU cache of rendered layers, keyed by content hash of (spec, w, h).
# T5225 re-requests the SAME layer on every frame of a burned-in range and
# T5210 on every card build, so caching matters; bounded so a long Overlay
# range can't grow memory unboundedly (design §6). Process-local, no disk/R2
# cache — layers are cheap to regenerate.
_LAYER_CACHE_MAXSIZE = 64
_LAYER_CACHE: "OrderedDict[str, Image.Image]" = OrderedDict()


def _cache_key(spec: TextSpec, frame_w: int, frame_h: int) -> str:
    """Deterministic content hash: sha256 of canonical (sorted-key) TextSpec
    JSON + "{w}x{h}" (design §6). Pydantic v2's model_dump_json does not sort
    keys by default, so the canonical form is built explicitly via
    json.dumps(..., sort_keys=True) — stable regardless of field-declaration
    order."""
    canonical_sorted = json.dumps(spec.model_dump(mode="json"), sort_keys=True)
    digest = hashlib.sha256(canonical_sorted.encode("utf-8")).hexdigest()
    return f"{digest}:{frame_w}x{frame_h}"


def _cache_get(key: str) -> Image.Image | None:
    img = _LAYER_CACHE.get(key)
    if img is not None:
        _LAYER_CACHE.move_to_end(key)  # LRU touch
    return img


def _cache_put(key: str, img: Image.Image) -> None:
    _LAYER_CACHE[key] = img
    _LAYER_CACHE.move_to_end(key)
    while len(_LAYER_CACHE) > _LAYER_CACHE_MAXSIZE:
        _LAYER_CACHE.popitem(last=False)  # evict least-recently-used


# T6620: "blur implies a shadow." The Overlay text rail exposes ONLY a Shadow
# blur slider (no opacity control) and a new overlay block defaults to
# shadow.opacity 0, so gating the shadow purely on opacity > 0 made the blur
# control inert by construction. Resolving a default opacity when blur > 0 but no
# explicit opacity was set makes the dialed-in shadow render. Card slots set
# their own opacity (> 0) and are unaffected. MUST stay in step with the frontend
# preview (src/frontend/src/constants/textSpec.js::DEFAULT_SHADOW_OPACITY) or a
# shadow shown in the preview would vanish on export.
DEFAULT_SHADOW_OPACITY = 0.6


def _resolve_shadow_opacity(shadow) -> float:
    """Effective shadow opacity: the explicit value if set, else the
    blur-implies-a-shadow default when blur > 0, else 0 (no shadow). Mirrors
    frontend resolveShadowOpacity."""
    if shadow.opacity > 0:
        return shadow.opacity
    return DEFAULT_SHADOW_OPACITY if shadow.blur > 0 else 0.0


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _wrap_paragraph(text: str, font: ImageFont.FreeTypeFont, max_px: float) -> list[str]:
    """Greedy word-wrap a single paragraph (no embedded newlines) at max_px,
    measuring each candidate line with font.getlength(). A single word longer
    than max_px overflows (no mid-word break in v1) — documented, not
    silently truncated (design §6 step 3)."""
    words = text.split(" ")
    if not words:
        return [""]

    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if font.getlength(candidate) <= max_px:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _wrap_text(text: str, font: ImageFont.FreeTypeFont, max_px: float) -> list[str]:
    """Honour explicit \\n first, then wrap within each paragraph (design §6 step 3)."""
    lines: list[str] = []
    for paragraph in text.split("\n"):
        lines.extend(_wrap_paragraph(paragraph, font, max_px))
    return lines


def render_text_layer(spec: TextSpec, frame_w: int, frame_h: int) -> Image.Image:
    """Render `spec` into an RGBA transparent layer sized (frame_w, frame_h).

    Algorithm (design §6):
      1. Resolve face + size from spec.font / spec.size (frame-height fraction).
      2. Line height from the face's OWN metrics (font.getmetrics()), never a
         hard-coded multiplier.
      3. Word wrap at spec.maxWidth (frame-width fraction), greedy.
      4. Multi-line alignment anchored at spec.position, interpreted per spec.align.
      5. Shadow -> stroke -> fill, in that Z order. blur_px/stroke_px are
         EM-RELATIVE (fractions of the resolved pixel `size`, not the frame
         directly) — see the unit invariant documented above TextSpec in
         app/schemas.py.
      6. Cache by content hash of (spec, frame_w, frame_h).
    """
    key = _cache_key(spec, frame_w, frame_h)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    # --- 1. Resolve face + size -------------------------------------------------
    px = round(spec.size * frame_h)
    px = max(px, 1)
    font = load_font_for_render(spec.font.value, px)

    # --- 2. Line height from face metrics ---------------------------------------
    ascent, descent = font.getmetrics()
    line_advance = ascent + descent

    # --- 3. Word wrap ------------------------------------------------------------
    max_px = spec.maxWidth * frame_w
    lines = _wrap_text(spec.text, font, max_px)

    # --- 4. Multi-line alignment --------------------------------------------------
    anchor_x = spec.position.x * frame_w
    anchor_y = spec.position.y * frame_h

    line_widths = [font.getlength(line) for line in lines]

    def _line_x(line_width: float) -> float:
        if spec.align == Align.LEFT:
            return anchor_x
        elif spec.align == Align.CENTER:
            return anchor_x - line_width / 2
        else:  # Align.RIGHT
            return anchor_x - line_width

    # --- 5. Resolve em-relative shadow/stroke pixel magnitudes -------------------
    # blur_px/stroke_px are fractions OF the already-resolved pixel `size`, not
    # a second fraction of the frame (gate decision Q1, unit invariant in schemas.py).
    blur_px = spec.shadow.blur * spec.size * frame_h
    stroke_px = spec.stroke.width * spec.size * frame_h
    stroke_width_int = round(stroke_px)

    layer = Image.new("RGBA", (frame_w, frame_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    fill_rgb = _hex_to_rgb(spec.color)

    # Shadow: text rasterised in shadow.color at the EFFECTIVE opacity, offset 0,
    # Gaussian-blurred by blur_px, composited UNDER the fill. T6620: the effective
    # opacity resolves "blur implies a shadow" (blur > 0 with no explicit opacity
    # -> a default), so the Overlay blur slider is no longer inert. Still skipped
    # entirely when the effective opacity is zero (blur == 0 AND opacity == 0) —
    # no wasted work, and this guarantees a zero-magnitude shadow produces
    # pixel-identical output to fill-only (required by
    # TestShadowStroke.test_shadow_off_matches_fill_only_no_extra_pixels).
    effective_shadow_opacity = _resolve_shadow_opacity(spec.shadow)
    if effective_shadow_opacity > 0:
        shadow_rgb = _hex_to_rgb(spec.shadow.color)
        shadow_alpha = round(effective_shadow_opacity * 255)
        shadow_layer = Image.new("RGBA", (frame_w, frame_h), (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow_layer)
        y = anchor_y
        for line, width in zip(lines, line_widths):
            x = _line_x(width)
            shadow_draw.text((x, y), line, font=font, fill=(*shadow_rgb, shadow_alpha))
            y += line_advance
        if blur_px > 0:
            shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(blur_px))
        layer = Image.alpha_composite(layer, shadow_layer)
        draw = ImageDraw.Draw(layer)

    # Stroke: ImageDraw.text(..., stroke_width=..., stroke_fill=...). Skipped
    # when width magnitude is zero.
    y = anchor_y
    for line, width in zip(lines, line_widths):
        x = _line_x(width)
        if stroke_width_int > 0:
            draw.text(
                (x, y),
                line,
                font=font,
                fill=(*fill_rgb, 255),
                stroke_width=stroke_width_int,
                stroke_fill=(*_hex_to_rgb(spec.stroke.color), 255),
            )
        else:
            draw.text((x, y), line, font=font, fill=(*fill_rgb, 255))
        y += line_advance

    _cache_put(key, layer)
    return layer
