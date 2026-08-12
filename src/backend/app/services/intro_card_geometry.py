"""Intro card geometry + motion timing + treatment palette — the shared contract
(T5210, measured layout + template typography added T6640).

THE source of truth for everything the render engine (`player_intro.py`) and the
browser editor/preview (`T5205`) must agree on to the pixel:

  1. **Photo geometry** — where the photo sits, per composition (`title-only` /
     `hero` / `broadcast` / `recruiting`) and per output aspect (`9:16` / `16:9`).
     Normalised 0..1 so ONE stored card frames identically at 1080x1920 and
     1920x1080 and in a small browser preview box.
  2. **Text REFLOW + TYPOGRAPHY (T6640)** — the text stack is no longer a set of
     fixed-y slots (that assumed a one-line title and let a wrapped long name
     collide with the slot below it — the reported bug). Instead each
     composition+aspect defines a REFLOW (anchor, column, rhythm gaps) and a
     TYPOGRAPHY table of three ROLES (`title` / `primary` / `secondary`); the
     shared `layout()` function below MEASURES each element's wrapped line count
     (via the SAME wrap algorithm `text_render.wrap_lines` uses) and stacks the
     block against the anchor. See "MEASURED LAYOUT" below for the full guarantee.
  3. **Motion timing** — the photo push-in, the per-element text stagger, and the
     white-flash EXIT into the footage. Same numbers the browser preview animates
     with; two copies would silently drift.
  4. **Treatment palette** — the `gold` / `dark` / `photo-forward` background,
     accent, band and photo grade (decision 2b/T6580), plus (T6640) the flat
     `seamColor` an inset photo's edge fades toward and the fixed `mutedColor`
     ROLE colour non-accent text uses. These ARE pixels, so they live in the
     contract (not the engine): otherwise the editor hardcodes its own
     approximation and the preview drifts from the export with nothing failing a
     test.

Python is the source of truth. `src/frontend/src/utils/introCardGeometry.js` is a
GENERATED mirror (regenerate with `python -m app.services.intro_card_geometry`) that
embeds the exact JSON below; `tests/test_t5210_geometry_parity.py` fails if the two
diverge. Same "one contract, both consumers, a parity test" shape T5180 uses for
`fonts.json` / `text_render` / `RichText`.

Coordinate convention (mirrors the TextSpec unit invariant in schemas.py):
  - `x` and `w`/`maxWidth` are fractions of the output frame WIDTH.
  - `y`, `h` and `size` are fractions of the output frame HEIGHT.
  - A photo rect `{x, y, w, h}` is the region of the frame the framed photo fills;
    the card's `focal_x`/`focal_y`/`zoom` then frame the image WITHIN it, so one
    stored framing works at both aspects (epic decision 3b).

============================================================================
T6640 — TEMPLATE-OWNED TYPOGRAPHY + MEASURED LAYOUT (epic decision 12)
============================================================================
Decision 12 makes the TEMPLATE own font/colour/size/weight/shadow/stroke/spacing
for cards — the user no longer styles a slot. That collapses the old per-slot
SEMANTIC styling (`text_elements`) entirely: every element now gets its
typography from a fixed ROLE, keyed off WHICH kind of line it is, never off which
card it's on:

    title     -> the name (Anton, large, treatment ACCENT colour)
    primary   -> the FIRST shown fact (fact1 = e.g. position; Oswald, accent)
    secondary -> the subtitle + any remaining facts (fact2, fact3; Oswald,
                 smaller, the fixed MUTED_COLOR) — grouped with class/team
                 per the visual hierarchy the task asked for.

`ROLE_FOR_SLOT` is the (trivial, parity-tested) map from a rendered SLOT
(`title`/`subtitle`/`fact1`/`fact2`/`fact3` — still ORDINAL, unchanged from
T5210) to its ROLE. Colour resolves via `ROLE_COLOR` (`"accent"` -> the
treatment's accent, `"muted"` -> the fixed `MUTED_COLOR`) so there is no
reachable colour clash: the user picks a TREATMENT, never a colour.

**Collision safety (the acute bug this design fixes):** a long two-word name
wraps to 2 lines. The OLD contract stored every slot's `y` as a fixed fraction,
so the second line ran into the slot below. The NEW `layout()` function instead
MEASURES how many lines each element wraps to (title may also SHRINK, bounded to
`typography.title.maxLines`, floored at `typography.title.minSize`) and stacks
the block from an ANCHOR:
  - `anchorMode: "bottom"` anchors the LAST element's baseline at `anchorFrac`;
    elements are placed walking UP from there. A taller (2-line) title makes the
    WHOLE block taller, but every element still ends at the SAME anchor, so the
    elements BELOW the title never move — a longer title only grows upward into
    empty space above it. This is what guarantees no collision regardless of
    line count (the geometry parity test's invariance assertions pin this).
  - `anchorMode: "center"` centres the block on `anchorFrac` (used where there is
    nothing below the stack to protect, e.g. recruiting/16:9's side panel).

`layout()` is intentionally the ONE place both `player_intro.py` and (its JS
mirror, `introCardPreviewElements.js`) compute stack position — the CONTRACT
DATA here (reflow params + role typography) is parity-tested byte-for-byte via
the existing `@parity:*` JSON mechanism; the wrap ALGORITHM the two runtimes use
to measure line counts is a separately-mirrored implementation
(`text_render.wrap_lines` <-> `RichText.jsx`'s `wrapLines`), guarded by an
extended Playwright parity spec (`e2e/T5180-text-parity.spec.js`). See
`docs/plans/tasks/T6640-design.md` §2 for the full three-layer parity argument.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.services.fonts import load_font_for_render
from app.services.intro_cards import (
    COMPOSITION_BROADCAST,
    COMPOSITION_HERO,
    COMPOSITION_RECRUITING,
    COMPOSITION_TITLE_ONLY,
    TREATMENTS,
)
from app.services.text_render import wrap_lines

# Aspect keys. A card renders at whatever the target reel is; `9:16` covers every
# portrait output and `16:9` every landscape one (a square reel resolves to
# `16:9`, see `aspect_key`). Greppable, never computed.
ASPECT_PORTRAIT = "9:16"
ASPECT_LANDSCAPE = "16:9"

# Text slots — still ORDINAL (T5210): `title` = the profile's Full Name;
# `subtitle` = free text on the card, ORTHOGONAL to composition; `fact1..fact3`
# are the ORDINAL fact-line positions, filled IN ORDER from the card's
# `shown_fields`. Unchanged by T6640 — only how each slot's TYPOGRAPHY and
# POSITION are resolved changed (role-based + measured, not per-slot styling).
SLOT_TITLE = "title"
SLOT_SUBTITLE = "subtitle"
SLOT_FACT1 = "fact1"
SLOT_FACT2 = "fact2"
SLOT_FACT3 = "fact3"

# Treatment keys — must match intro_cards.TREATMENTS exactly (asserted at import).
TREATMENT_GOLD = "gold"
TREATMENT_DARK = "dark"
TREATMENT_PHOTO_FORWARD = "photo-forward"

ALIGN_LEFT = "left"
ALIGN_CENTER = "center"

# T6640 typography roles. `title` and `primary` take the treatment ACCENT;
# `secondary` (subtitle + fact2/fact3) takes the fixed MUTED_COLOR — never
# per-treatment (supervisor decision: one fixed muted grey everywhere; simpler
# and still reads on all three treatments per the design-gate matrix).
ROLE_TITLE = "title"
ROLE_PRIMARY = "primary"
ROLE_SECONDARY = "secondary"
MUTED_COLOR = "#c3cad6"

# Which ROLE each ordinal SLOT resolves to. `fact1` is the PRIMARY fact (larger,
# accented — the single most important stat); `fact2`/`fact3` are SECONDARY,
# grouped visually with the subtitle (smaller, muted) rather than each having
# independent styling — this is what gives the card real hierarchy instead of an
# evenly-weighted list (task §C "no hierarchy below the name").
ROLE_FOR_SLOT: dict[str, str] = {
    SLOT_TITLE: ROLE_TITLE,
    SLOT_SUBTITLE: ROLE_SECONDARY,
    SLOT_FACT1: ROLE_PRIMARY,
    SLOT_FACT2: ROLE_SECONDARY,
    SLOT_FACT3: ROLE_SECONDARY,
}

# Full-bleed photo rect, reused where the photo backs the whole frame.
_FULL_BLEED = {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}


def _role_typo(
    font: str, size: float, shadow: dict, *, min_size: float | None = None, max_lines: int | None = None
) -> dict:
    out = {"font": font, "size": size, "shadow": shadow}
    if min_size is not None:
        out["minSize"] = min_size
    if max_lines is not None:
        out["maxLines"] = max_lines
    return out


def _reflow(
    *, anchor_x: float, align: str, max_width: float, anchor_mode: str, anchor_frac: float,
    gap_after_title: float, gap_group: float, gap_line: float,
    seam_side: str = "none", seam_feather: float = 0.0,
) -> dict:
    return {
        "anchorX": anchor_x, "align": align, "maxWidth": max_width,
        "anchorMode": anchor_mode, "anchorFrac": anchor_frac,
        "gapAfterTitle": gap_after_title, "gapGroup": gap_group, "gapLine": gap_line,
        "seamSide": seam_side, "seamFeather": seam_feather,
    }


# Shared role-typography building blocks. Title/primary/secondary read the SAME
# fonts + shadow strengths across every composition (Anton title, Oswald facts —
# T5180's original defaults), so only SIZE/rhythm vary by composition/aspect.
_TITLE_SHADOW = {"blur": 0.05, "color": "#000000", "opacity": 0.6}
_FACT_SHADOW = {"blur": 0.04, "color": "#000000", "opacity": 0.55}


def _typography(title_size, title_min, primary_size, secondary_size, max_lines: int = 2) -> dict:
    return {
        ROLE_TITLE: _role_typo("anton", title_size, dict(_TITLE_SHADOW), min_size=title_min, max_lines=max_lines),
        ROLE_PRIMARY: _role_typo("oswald", primary_size, dict(_FACT_SHADOW)),
        ROLE_SECONDARY: _role_typo("oswald", secondary_size, dict(_FACT_SHADOW)),
    }


# =============================================================================
# GEOMETRY  (composition -> aspect -> {photo, reflow, typography})
# =============================================================================
# T6640 replaced the old fixed-y `slots` dict with `reflow` (anchor + rhythm) +
# `typography` (role sizing); `layout()` below measures + stacks at render time.
# Numbers here are the T6640 design-gate approved starting point (recruiting was
# rendered through the real pixel path in the 12-card matrix; hero/broadcast/
# title-only follow the same anchor-from-the-bottom principle, scaled from the
# T5210 fixed-y values they replace, and are covered by the wrap-regression
# matrix in tests/test_t5210_player_intro.py).
GEOMETRY: dict[str, dict[str, dict]] = {
    COMPOSITION_TITLE_ONLY: {
        # No facts (0). Title + optional subtitle, centred as one text-forward
        # block — a full-bleed scrimmed photo (if any) sits behind it.
        ASPECT_PORTRAIT: {
            "photo": dict(_FULL_BLEED),
            "reflow": _reflow(
                anchor_x=0.5, align=ALIGN_CENTER, max_width=0.86,
                anchor_mode="center", anchor_frac=0.45,
                gap_after_title=0.020, gap_group=0.020, gap_line=0.010,
            ),
            "typography": _typography(0.080, 0.058, 0.040, 0.036),
        },
        ASPECT_LANDSCAPE: {
            "photo": dict(_FULL_BLEED),
            "reflow": _reflow(
                anchor_x=0.5, align=ALIGN_CENTER, max_width=0.86,
                anchor_mode="center", anchor_frac=0.47,
                gap_after_title=0.025, gap_group=0.025, gap_line=0.012,
            ),
            "typography": _typography(0.150, 0.100, 0.070, 0.062),
        },
    },
    COMPOSITION_HERO: {
        # 1 fact (primary only). Bottom-anchored lower-third over a full-bleed
        # photo push-in.
        ASPECT_PORTRAIT: {
            "photo": dict(_FULL_BLEED),
            "reflow": _reflow(
                anchor_x=0.5, align=ALIGN_CENTER, max_width=0.84,
                anchor_mode="bottom", anchor_frac=0.90,
                gap_after_title=0.014, gap_group=0.028, gap_line=0.010,
            ),
            "typography": _typography(0.072, 0.050, 0.040, 0.030, max_lines=2),
        },
        ASPECT_LANDSCAPE: {
            "photo": dict(_FULL_BLEED),
            "reflow": _reflow(
                anchor_x=0.06, align=ALIGN_LEFT, max_width=0.60,
                anchor_mode="bottom", anchor_frac=0.93,
                gap_after_title=0.018, gap_group=0.035, gap_line=0.012,
            ),
            "typography": _typography(0.125, 0.085, 0.062, 0.052),
        },
    },
    COMPOSITION_BROADCAST: {
        # 2 facts (primary + one secondary). Bottom-anchored lower-third.
        ASPECT_PORTRAIT: {
            "photo": dict(_FULL_BLEED),
            "reflow": _reflow(
                anchor_x=0.5, align=ALIGN_CENTER, max_width=0.84,
                anchor_mode="bottom", anchor_frac=0.90,
                gap_after_title=0.012, gap_group=0.026, gap_line=0.010,
            ),
            "typography": _typography(0.068, 0.048, 0.036, 0.028),
        },
        ASPECT_LANDSCAPE: {
            "photo": dict(_FULL_BLEED),
            "reflow": _reflow(
                anchor_x=0.06, align=ALIGN_LEFT, max_width=0.58,
                anchor_mode="bottom", anchor_frac=0.95,
                gap_after_title=0.016, gap_group=0.032, gap_line=0.010,
            ),
            "typography": _typography(0.115, 0.078, 0.058, 0.044),
        },
    },
    COMPOSITION_RECRUITING: {
        # 3 facts (primary + two secondary) — the densest composition, and the
        # one from the reported bug. Portrait: inset photo TOP 56%, bottom-
        # anchored text below it with a seam fade at the photo's bottom edge.
        # Landscape: inset photo LEFT 52%, text panel RIGHT, centre-anchored
        # (nothing below the stack to protect), seam fade at the photo's right
        # edge. T6640 design-gate matrix (qa/matrix/*) proved this composition
        # at both aspects x all 3 treatments x {short, long} name never collides.
        ASPECT_PORTRAIT: {
            "photo": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.56},
            "reflow": _reflow(
                anchor_x=0.5, align=ALIGN_CENTER, max_width=0.88,
                anchor_mode="bottom", anchor_frac=0.94,
                gap_after_title=0.012, gap_group=0.030, gap_line=0.008,
                seam_side="bottom", seam_feather=0.16,
            ),
            "typography": _typography(0.076, 0.052, 0.044, 0.030),
        },
        ASPECT_LANDSCAPE: {
            "photo": {"x": 0.0, "y": 0.0, "w": 0.52, "h": 1.0},
            "reflow": _reflow(
                anchor_x=0.575, align=ALIGN_LEFT, max_width=0.40,
                anchor_mode="center", anchor_frac=0.50,
                gap_after_title=0.020, gap_group=0.050, gap_line=0.012,
                seam_side="right", seam_feather=0.18,
            ),
            "typography": _typography(0.150, 0.095, 0.072, 0.050),
        },
    },
}


# =============================================================================
# TREATMENT PALETTE  (treatment -> {background, accent, band, photoMood, seamColor})
# =============================================================================
# A treatment must VISIBLY change the card even on a full-bleed photo, where the
# `background` is hidden (T6580 item 4 — the "changing Style barely changes
# anything" complaint). So each treatment OWNS these, ALL here in the shared
# contract (never in the editor only) so the browser preview and the ffmpeg export
# render the same pixels:
#   - background : the radial/solid backdrop (hidden behind a full-bleed photo;
#     visible on `recruiting`'s inset). Encoded as endpoints + centre + extent so
#     both sides paint the same gradient (editor: CSS `radial-gradient`; engine:
#     ffmpeg `geq`, d = hypot((x-cx)/ex, (y-cy)/ey), stops lerped by
#     clip(d/lastStopPos, 0, 1)). `css` is the exact editor string, kept for a
#     1:1 check.
#   - accent     : the title's + primary fact's colour (T6640 ROLE_COLOR "accent").
#   - band (B)   : a SOLID lower-third ground behind the text, so contrast stops
#     depending on the photo AND the treatment differs on ANY footage. A vertical
#     band filled with `color` at `opacity`, `heightFrac` of the frame HEIGHT tall
#     (EXPLICIT, not implicit), with the top `featherFrac` of the band fading in
#     so it has no hard edge. Applies only to the `bandCompositions` (lower-third
#     text over a full-bleed photo). `photo-forward` has NO band (photo dominates
#     — the plain scrim stays). Gold is DESATURATED + dark ("pull the gold back").
#   - photoMood (C): a colour GRADE over the photo — a `tint` (a normal-alpha
#     colour wash: warm for gold, cool for dark; none for photo-forward) and a
#     `vignette` (radial edge-darkening: soft for gold, strong/moody for dark;
#     none for photo-forward). Normal-alpha (not multiply) so CSS and PIL match
#     to the pixel. tint = {color, opacity}; vignette = {opacity, innerFrac}
#     (transparent inside `innerFrac` of the half-diagonal, ramping to `opacity`
#     at the corner). `null` = that grade is off.
#   - seamColor (T6640): the flat colour an INSET photo's edge (`reflow.seamSide`)
#     fades toward, so recruiting's photo/panel seam bleeds into the background
#     instead of a hard 50/50 cut (task §C). Deliberately the treatment's own
#     outer/solid background colour (not a separate pick) so the fade always
#     matches what is actually behind it.
#
# Direction: B + C combined, gold pulled back (T6580 item 4, user-approved).
TREATMENTS_CONTRACT: dict[str, dict] = {
    TREATMENT_GOLD: {
        "background": {
            "type": "radial",
            "center": [0.5, 0.0],
            "extent": [1.2, 1.2],
            "stops": [
                {"color": "#2a2410", "pos": 0.0},
                {"color": "#0d0b06", "pos": 0.70},
            ],
            "css": "radial-gradient(120% 120% at 50% 0%, #2a2410 0%, #0d0b06 70%)",
        },
        "accent": "#f7e28b",
        # Desaturated dark-warm ground (NOT the loud bright gold of the sample).
        "band": {"color": "#241a0b", "opacity": 0.9, "heightFrac": 0.44, "featherFrac": 0.16},
        "photoMood": {
            "tint": {"color": "#5a3a12", "opacity": 0.22},   # warm/premium
            "vignette": {"opacity": 0.5, "innerFrac": 0.45, "extent": 0.78},
        },
        "seamColor": "#0d0b06",
    },
    TREATMENT_DARK: {
        "background": {
            "type": "radial",
            "center": [0.5, 0.0],
            "extent": [1.2, 1.2],
            "stops": [
                {"color": "#1a2230", "pos": 0.0},
                {"color": "#05070b", "pos": 0.70},
            ],
            "css": "radial-gradient(120% 120% at 50% 0%, #1a2230 0%, #05070b 70%)",
        },
        "accent": "#e5e7eb",
        "band": {"color": "#0e1622", "opacity": 0.92, "heightFrac": 0.44, "featherFrac": 0.16},
        "photoMood": {
            "tint": {"color": "#16233a", "opacity": 0.26},   # cool/moody
            "vignette": {"opacity": 0.62, "innerFrac": 0.38, "extent": 0.74},
        },
        "seamColor": "#05070b",
    },
    TREATMENT_PHOTO_FORWARD: {
        "background": {
            "type": "solid",
            "color": "#04060a",
            "css": "#04060a",
        },
        "accent": "#ffffff",
        "band": None,                                        # clean/natural — no band
        "photoMood": {"tint": None, "vignette": None},       # no grade
        "seamColor": "#04060a",
    },
}

# The compositions whose text sits in the lower third OVER a full-bleed photo, so
# a treatment band grounds it. title-only centres its title (no lower-third band)
# and recruiting puts its text on the treatment background beside the inset photo
# (already grounded). Contract-driven (mirrored to JS) so preview and export gate
# the band identically — the same "one rule, both consumers" shape as the scrim.
BAND_COMPOSITIONS: tuple[str, ...] = (COMPOSITION_HERO, COMPOSITION_BROADCAST)


# =============================================================================
# MOTION TIMING  (seconds, relative to the card timeline 0..duration)
# =============================================================================
# Card `duration` is stored per-card; these are the relative offsets both the
# renderer and the browser preview animate with. The stagger runs in slot ORDER
# (title, subtitle, fact1, fact2, fact3): element i begins at `firstSt + i*step`. The exit
# flash is the LAST beat, so the card's final frame is a deterministic white that
# cuts cleanly into the reel (mirrors T5240's flash, applied last).
MOTION: dict[str, float | int] = {
    "photoPushInZoomStart": 1.0,
    "photoPushInZoomEnd": 1.12,
    "textStaggerFirstSt": 0.35,
    "textStaggerStep": 0.16,
    "textFadeD": 0.45,
    "textRiseFrac": 0.02,
    "flashOutD": 0.22,
}

# The slot order the stagger walks. Shared so the preview and the renderer index
# the stagger identically.
STAGGER_ORDER: tuple[str, ...] = (
    SLOT_TITLE,
    SLOT_SUBTITLE,
    SLOT_FACT1,
    SLOT_FACT2,
    SLOT_FACT3,
)

# Invariant: the treatment palette and intro_cards.TREATMENTS must not drift.
assert set(TREATMENTS_CONTRACT) == set(TREATMENTS), (
    "intro_card_geometry.TREATMENTS_CONTRACT is out of sync with "
    "intro_cards.TREATMENTS"
)


def aspect_key(width: int, height: int) -> str:
    """Resolve an output frame size to its contract aspect key. Landscape and
    square (`width >= height`) -> 16:9; portrait -> 9:16. Mirrored verbatim in
    the JS accessor so both sides bucket a given reel the same way."""
    return ASPECT_LANDSCAPE if width >= height else ASPECT_PORTRAIT


def geometry_for(composition: str, aspect: str) -> dict:
    """Return `{photo, reflow, typography}` for a composition + aspect key.
    Unknown keys RAISE (a drift bug, never a silent fallback)."""
    try:
        return GEOMETRY[composition][aspect]
    except KeyError as e:
        raise KeyError(
            f"no intro card geometry for composition={composition!r} "
            f"aspect={aspect!r}"
        ) from e


def treatment_for(treatment: str) -> dict:
    """Return `{background, accent, band, photoMood, seamColor}` for a treatment
    key. Unknown keys RAISE."""
    try:
        return TREATMENTS_CONTRACT[treatment]
    except KeyError as e:
        raise KeyError(f"unknown treatment {treatment!r}") from e


def band_kind(composition: str) -> str:
    """Whether a treatment band applies for a composition: `bottom` for the
    lower-third-over-photo looks, else `none`. Mirrored verbatim in JS
    (`bandKind`) so preview and export gate the band identically."""
    return "bottom" if composition in BAND_COMPOSITIONS else "none"


# =============================================================================
# MEASURED LAYOUT  (T6640) — the ONE function both renderers stack text with.
# =============================================================================
def _gap_between(prev_role: str | None, role: str, reflow: dict) -> float:
    """Rhythm gap BEFORE `role`, given the role that preceded it (None = first
    element). Deliberately UNEQUAL so the stack reads as GROUPS, not an evenly-
    spaced list (task §C):
      - after the title (whatever comes next: a subtitle or the primary fact) ->
        `gapAfterTitle`, tight — a subtitle/leading fact reads as part of the
        name's own block.
      - secondary -> secondary (e.g. fact2 -> fact3) -> `gapLine`, tight — same
        supporting-facts group.
      - every other transition (entering or leaving the primary fact) ->
        `gapGroup`, the largest gap — a new visual group starts.
    """
    if prev_role is None:
        return 0.0
    if prev_role == ROLE_TITLE:
        return reflow["gapAfterTitle"]
    if prev_role == ROLE_SECONDARY and role == ROLE_SECONDARY:
        return reflow["gapLine"]
    return reflow["gapGroup"]


def _fit_title(text: str, typo: dict, frame_w: int, frame_h: int, max_width_frac: float) -> tuple[float, int]:
    """Shrink-to-fit the title role: reduce `size` in small steps until it wraps
    to <= `typography.title.maxLines`, floored at `minSize` (task §A shrink-to-fit
    — bounds the block height by construction). Returns (size_frac, line_count)."""
    size = typo["size"]
    min_size = typo["minSize"]
    max_lines = typo["maxLines"]
    max_px = max_width_frac * frame_w
    step = 0.002
    while size > min_size:
        px = max(round(size * frame_h), 1)
        font = load_font_for_render(typo["font"], px)
        lines = wrap_lines(text, font, max_px)
        if len(lines) <= max_lines:
            return size, len(lines)
        size = round(size - step, 4)
    px = max(round(min_size * frame_h), 1)
    font = load_font_for_render(typo["font"], px)
    return min_size, len(wrap_lines(text, font, max_px))


def _count_lines(text: str, size_frac: float, font_key: str, frame_w: int, frame_h: int, max_width_frac: float) -> int:
    px = max(round(size_frac * frame_h), 1)
    font = load_font_for_render(font_key, px)
    return len(wrap_lines(text, font, max_width_frac * frame_w))


def _advance_frac(size_frac: float, font_key: str, frame_h: int) -> float:
    """Line advance (ascent + descent, the face's OWN metrics — never a hard-coded
    multiplier, matching text_render's rule) as a fraction of frame height."""
    px = max(round(size_frac * frame_h), 1)
    ascent, descent = load_font_for_render(font_key, px).getmetrics()
    return (ascent + descent) / frame_h


def layout(
    composition: str, aspect: str, elements: list[tuple[str, str]], accent: str, frame_w: int, frame_h: int,
) -> dict[str, dict]:
    """Compute the measured, anchored text stack for `elements` — an ORDERED list
    of `(slot, text)` pairs already filtered to the slots that will actually
    render (blank facts/subtitle/title already excluded by the caller), in
    STAGGER_ORDER.

    Returns `{slot: {x, y, size, align, maxWidth, font, color, shadow}}` — every
    field `_merge_spec`/`mergeSpec` need to build a full TextSpec directly; the
    caller no longer reads any per-card styling.

    Collision guarantee (see the module docstring's T6640 section): the block is
    placed against `reflow.anchorMode`/`anchorFrac`. For `"bottom"`, every
    element's position is `anchorFrac - (height of everything from here to the
    end of the stack)`, so a taller title only pushes elements ABOVE it (the
    title itself) upward — an element's OWN allocated slot never shrinks
    because of what comes before it. That guarantee only holds, though, if the
    RESERVED line count used to size the title's slot here equals what actually
    gets DRAWN: an under-reserved title still occupies its real (larger) drawn
    height, which spills downward past its reserved boundary onto whatever
    element follows immediately after it (T6640 round 3/4 — the frontend
    mirror agreeing with `text_render.wrap_lines` isn't enough on its own; the
    renderer must also draw EXACTLY the line count reserved here, never a
    fresh re-wrap of its own — see `RichText.jsx`'s `wrapperStyle`/`textStyle`
    comments for the round-4 CSS bug this bit the frontend with).
    """
    geo = geometry_for(composition, aspect)
    reflow = geo["reflow"]
    typo = geo["typography"]

    measured = []  # (slot, role, rt, size, lines, advance, gap)
    prev_role: str | None = None
    for slot, text in elements:
        role = ROLE_FOR_SLOT[slot]
        rt = typo[role]
        if role == ROLE_TITLE:
            size, lines = _fit_title(text, rt, frame_w, frame_h, reflow["maxWidth"])
        else:
            size = rt["size"]
            lines = _count_lines(text, size, rt["font"], frame_w, frame_h, reflow["maxWidth"])
        advance = _advance_frac(size, rt["font"], frame_h)
        gap = _gap_between(prev_role, role, reflow)
        measured.append((slot, role, rt, size, lines, advance, gap))
        prev_role = role

    total = sum(m[4] * m[5] for m in measured) + sum(m[6] for m in measured)
    mode, frac = reflow["anchorMode"], reflow["anchorFrac"]
    top = (frac - total) if mode == "bottom" else (frac - total / 2)

    out: dict[str, dict] = {}
    y = top
    for slot, role, rt, size, lines, advance, gap in measured:
        y += gap
        color = accent if role in (ROLE_TITLE, ROLE_PRIMARY) else MUTED_COLOR
        out[slot] = {
            "x": reflow["anchorX"], "y": y, "size": size, "align": reflow["align"],
            "maxWidth": reflow["maxWidth"], "font": rt["font"], "color": color,
            "shadow": rt["shadow"],
        }
        y += lines * advance
    return out


# =============================================================================
# JS MIRROR GENERATION + PARITY
# =============================================================================
def _js_path() -> Path:
    """Target path for the generated JS mirror. Dev-time tooling only (the
    generator + its `__main__` entrypoint) — never called from any serve-time
    path. Computed lazily so importing this module never touches the
    filesystem layout: in the deployed Fly image (`WORKDIR /app` + `COPY . .`)
    this module sits only 4 levels below the image root, one short of the
    5-level repo checkout depth `parents[4]` assumes, so eager computation at
    import time raised `IndexError: 4` on every Fly deploy (T6920)."""
    try:
        repo_root = Path(__file__).resolve().parents[4]
    except IndexError as e:
        raise RuntimeError(
            "_js_path() requires the repo checkout layout "
            "(<root>/src/backend/app/services/intro_card_geometry.py); "
            "not available at this file depth"
        ) from e
    return repo_root / "src" / "frontend" / "src" / "utils" / "introCardGeometry.js"


def contract_as_dict() -> dict:
    """The full contract as a plain JSON-able structure — the exact object the JS
    mirror embeds and the parity test compares against."""
    return {
        "geometry": GEOMETRY,
        "treatments": TREATMENTS_CONTRACT,
        "motion": MOTION,
        "staggerOrder": list(STAGGER_ORDER),
        "aspects": {"portrait": ASPECT_PORTRAIT, "landscape": ASPECT_LANDSCAPE},
        "bandCompositions": list(BAND_COMPOSITIONS),
        "roleForSlot": ROLE_FOR_SLOT,
        "mutedColor": MUTED_COLOR,
    }


def render_js_mirror() -> str:
    """Build the generated `introCardGeometry.js` content. The data blocks are
    wrapped in `@parity:*` markers so the parity test can extract and re-parse
    them as JSON without needing a JS runtime."""
    c = contract_as_dict()
    geometry = json.dumps(c["geometry"], indent=2, sort_keys=True)
    treatments = json.dumps(c["treatments"], indent=2, sort_keys=True)
    motion = json.dumps(c["motion"], indent=2, sort_keys=True)
    stagger = json.dumps(c["staggerOrder"])
    aspects = json.dumps(c["aspects"], indent=2, sort_keys=True)
    band_compositions = json.dumps(c["bandCompositions"])
    role_for_slot = json.dumps(c["roleForSlot"], indent=2, sort_keys=True)
    muted_color = json.dumps(c["mutedColor"])
    return f"""// GENERATED FROM app/services/intro_card_geometry.py — do not hand-edit.
// Regenerate: cd src/backend && .venv/Scripts/python.exe -m app.services.intro_card_geometry
// Parity is enforced by src/backend/tests/test_t5210_geometry_parity.py.
//
// Shared intro-card slot geometry + motion timing + treatment palette (T5210,
// measured layout + template typography T6640). See the Python module for the
// coordinate convention and the T6640 role/reflow/layout() rationale. The editor
// (T5205) reads THESE numbers so its live preview + motion + treatment swatches
// match the render engine.

export const CARD_ASPECTS = /* @parity:aspects:start */ {aspects} /* @parity:aspects:end */;

export const INTRO_CARD_GEOMETRY = /* @parity:geometry:start */ {geometry} /* @parity:geometry:end */;

export const INTRO_CARD_TREATMENTS = /* @parity:treatments:start */ {treatments} /* @parity:treatments:end */;

export const INTRO_CARD_MOTION = /* @parity:motion:start */ {motion} /* @parity:motion:end */;

export const STAGGER_ORDER = /* @parity:staggerOrder:start */ {stagger} /* @parity:staggerOrder:end */;

export const BAND_COMPOSITIONS = /* @parity:bandCompositions:start */ {band_compositions} /* @parity:bandCompositions:end */;

// T6640: ordinal SLOT -> typography ROLE (title/primary/secondary). Mirrors
// `intro_card_geometry.ROLE_FOR_SLOT` exactly.
export const ROLE_FOR_SLOT = /* @parity:roleForSlot:start */ {role_for_slot} /* @parity:roleForSlot:end */;

// T6640: the fixed colour every "secondary"-role element uses (subtitle,
// fact2, fact3) — one flat muted grey across all three treatments.
export const MUTED_COLOR = /* @parity:mutedColor:start */ {muted_color} /* @parity:mutedColor:end */;

/**
 * Resolve an output frame size to its contract aspect key. Mirrors
 * `intro_card_geometry.aspect_key` on the backend (landscape/square -> 16:9).
 * @param {{number}} width
 * @param {{number}} height
 * @returns {{string}}
 */
export function aspectKey(width, height) {{
  return width >= height ? CARD_ASPECTS.landscape : CARD_ASPECTS.portrait;
}}

/**
 * `{{photo, reflow, typography}}` for a composition + aspect key. Throws on an
 * unknown key (a drift bug, never a silent fallback) to match the Python
 * accessor.
 * @param {{string}} composition one of COMPOSITION.* (introCardComposition.js)
 * @param {{string}} aspect one of CARD_ASPECTS.*
 */
export function geometryFor(composition, aspect) {{
  const byAspect = INTRO_CARD_GEOMETRY[composition];
  const geo = byAspect && byAspect[aspect];
  if (!geo) {{
    throw new Error(
      `no intro card geometry for composition=${{composition}} aspect=${{aspect}}`
    );
  }}
  return geo;
}}

/**
 * `{{background, accent, band, photoMood, seamColor}}` for a treatment key.
 * Throws on an unknown key.
 * @param {{string}} treatment one of TREATMENTS (introCardComposition.js)
 */
export function treatmentFor(treatment) {{
  const t = INTRO_CARD_TREATMENTS[treatment];
  if (!t) {{
    throw new Error(`unknown treatment=${{treatment}}`);
  }}
  return t;
}}

/**
 * Whether a treatment band applies for a composition (`bottom` | `none`).
 * Mirrors `intro_card_geometry.band_kind` so preview and export gate it the same.
 * @param {{string}} composition one of COMPOSITION.* (introCardComposition.js)
 */
export function bandKind(composition) {{
  return BAND_COMPOSITIONS.includes(composition) ? 'bottom' : 'none';
}}
"""


def write_js_mirror() -> Path:
    """Write the generated JS mirror to disk and return its path."""
    content = render_js_mirror()
    js_path = _js_path()
    js_path.write_text(content, encoding="utf-8", newline="\n")
    return js_path


if __name__ == "__main__":
    path = write_js_mirror()
    print(f"wrote {path}")
