"""Intro card geometry + motion timing + treatment palette — the shared contract (T5210).

THE source of truth for everything the render engine (`player_intro.py`, this task)
and the browser editor/preview (`T5205`) must agree on to the pixel:

  1. **Slot geometry** — where the photo and each text line sit, per composition
     (`title-only` / `hero` / `broadcast` / `recruiting`) and per output aspect
     (`9:16` / `16:9`). Normalised 0..1 so ONE stored card frames identically at
     1080x1920 and 1920x1080 and in a small browser preview box.
  2. **Motion timing** — the photo push-in, the per-element text stagger, and the
     white-flash EXIT into the footage. Same numbers the browser preview animates
     with; two copies would silently drift.
  3. **Treatment palette** — the `gold` / `dark` / `photo-forward` background +
     accent the user picks from swatches. These ARE pixels, so they live in the
     contract (not the engine): otherwise the editor hardcodes its own approximation
     and the preview drifts from the export with nothing failing a test. The values
     are adopted verbatim from T5205's `introCardEditorConstants.js` so the editor's
     look does not change — the contract just makes them canonical.

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
  - A text slot `{x, y, maxWidth, size, align}` carries LAYOUT only. `x` is the
    anchor read per `align` (left edge / centre), `y` is the block's TOP edge. The
    card's per-slot TextSpec supplies the STYLING (font, colour, weight, shadow,
    stroke); font SIZE and POSITION are layout-owned (composition-derived), never
    stored on the card — that is what guarantees a consistent look with no empty
    slots.

============================================================================
THE MOST CONFUSABLE THING IN THIS DESIGN — geometry is ORDINAL, styling is
SEMANTIC, and the renderer maps between them. Read this before touching either.
============================================================================
  - GEOMETRY slots are ORDINAL: `fact1`/`fact2`/`fact3` are the 1st/2nd/3rd fact
    LINE's position on the card. Geometry is about WHERE a line sits, so the Nth
    shown fact always uses `fact{N}`'s rect regardless of which fact it is.
  - STYLING is keyed SEMANTICALLY in the card's `text_elements` blob — by
    `title` / `position` / `class` / `team`, NOT by ordinal. Styling must follow
    the FACT so un-ticking one fact never transfers its styling to another.
  - The card's `text_elements` is **STYLING ONLY** (shipped v034 schema, T5195):
    T5205 writes `''` into every `text_elements[slot].text`. NEVER read the text
    from there or you render blank lines. Text sources:
        * title    -> the PROFILE's Full Name, ALWAYS (T6620), passed in as
          `field_values["full_name"]`. `card["title_text"]` is DEAD — no longer
          read (was a pre-T6570 override; nulled by migration v036). omit+log
          if blank.
        * subtitle -> the card's `subtitle_text` column (free text on THIS card,
          e.g. a tournament name; T6570 / migration v035). omit+log if blank.
        * factN    -> the PROFILE value for `shown_fields[N-1]` (omit+log if blank)
  - So the renderer walks:
        for i, field in enumerate(card["shown_fields"]):
            geo_slot = geometry.slots[f"fact{i+1}"]      # ORDINAL position
            styling  = card["text_elements"].get(field)  # SEMANTIC styling (may be None)
            value    = field_values.get(field)           # PROFILE value (omit if blank)
    and for title/subtitle: geo_slot = slots["title"|"subtitle"], styling =
    text_elements.get(...), text = full name / card["subtitle_text"].
  - The `subtitle` slot is ORTHOGONAL to composition (like the treatment axis):
    it is free text the user turns on and does NOT count toward the fact-count,
    so adding a subtitle never changes which composition is derived.

Nothing here is stored on a card. Composition is derived from
(`has_photo`, `shown_fields`) via `intro_cards.derive_composition`; this module only
says how each derived composition is laid out, moves and coloured.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.services.intro_cards import (
    COMPOSITION_BROADCAST,
    COMPOSITION_HERO,
    COMPOSITION_RECRUITING,
    COMPOSITION_TITLE_ONLY,
    TREATMENTS,
)

# Aspect keys. A card renders at whatever the target reel is; `9:16` covers every
# portrait output and `16:9` every landscape one (a square reel resolves to
# `16:9`, see `aspect_key`). Greppable, never computed.
ASPECT_PORTRAIT = "9:16"
ASPECT_LANDSCAPE = "16:9"

# Text slots. `title` = the profile's Full Name (T6570); `subtitle` = free text
# on the card (T6570; a tournament name etc.), ORTHOGONAL to composition;
# `fact1..fact3` are the ORDINAL fact-line positions, filled IN ORDER from the
# card's `shown_fields` with the VALUE read from the profile (see the mapping
# note above).
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

# Full-bleed photo rect, reused where the photo backs the whole frame.
_FULL_BLEED = {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}


def _slot(x: float, y: float, max_width: float, size: float, align: str) -> dict:
    return {"x": x, "y": y, "maxWidth": max_width, "size": size, "align": align}


# =============================================================================
# SLOT GEOMETRY  (composition -> aspect -> {photo, slots})
# =============================================================================
# Approved values (T5210 design gate; the subtitle slot + the title positions
# that make room for it are RESTORED from commit c806e2a5, where they were
# reviewed and approved, after being dropped when the subtitle was removed —
# T6570 gives the subtitle a data source, so it comes back). The photo placement
# is what separates the four looks:
#   - title-only : a text-forward card; the photo (if any) is a full-bleed,
#     scrimmed background, title + subtitle centred.
#   - hero       : the photo IS the card (full-bleed push-in); a name + one fact
#     sit in the lower third. 16:9 anchors the text left so the subject stays clear.
#   - broadcast  : full-bleed photo + a lower-third band; name + two facts.
#   - recruiting : the "profile" look — an INSET photo (top band at 9:16, left
#     column at 16:9) with a denser three-fact stack beside/below it.
# The `subtitle` slot is present in EVERY composition but ORTHOGONAL to it: an
# empty subtitle is simply omitted (like an unticked fact), so a card without one
# looks exactly as before; a card with one gets the sub-heading between the title
# and the facts. Adding a subtitle NEVER changes the derived composition.
GEOMETRY: dict[str, dict[str, dict]] = {
    COMPOSITION_TITLE_ONLY: {
        ASPECT_PORTRAIT: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.5, 0.40, 0.86, 0.072, ALIGN_CENTER),
                SLOT_SUBTITLE: _slot(0.5, 0.50, 0.80, 0.034, ALIGN_CENTER),
            },
        },
        ASPECT_LANDSCAPE: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.5, 0.38, 0.86, 0.135, ALIGN_CENTER),
                SLOT_SUBTITLE: _slot(0.5, 0.60, 0.80, 0.060, ALIGN_CENTER),
            },
        },
    },
    COMPOSITION_HERO: {
        ASPECT_PORTRAIT: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.5, 0.72, 0.90, 0.066, ALIGN_CENTER),
                SLOT_SUBTITLE: _slot(0.5, 0.795, 0.80, 0.030, ALIGN_CENTER),
                SLOT_FACT1: _slot(0.5, 0.84, 0.80, 0.034, ALIGN_CENTER),
            },
        },
        ASPECT_LANDSCAPE: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.06, 0.66, 0.62, 0.120, ALIGN_LEFT),
                SLOT_SUBTITLE: _slot(0.06, 0.80, 0.55, 0.050, ALIGN_LEFT),
                SLOT_FACT1: _slot(0.06, 0.865, 0.55, 0.055, ALIGN_LEFT),
            },
        },
    },
    COMPOSITION_BROADCAST: {
        ASPECT_PORTRAIT: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.5, 0.66, 0.90, 0.062, ALIGN_CENTER),
                SLOT_SUBTITLE: _slot(0.5, 0.735, 0.80, 0.028, ALIGN_CENTER),
                SLOT_FACT1: _slot(0.5, 0.79, 0.80, 0.030, ALIGN_CENTER),
                SLOT_FACT2: _slot(0.5, 0.845, 0.80, 0.030, ALIGN_CENTER),
            },
        },
        ASPECT_LANDSCAPE: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.06, 0.62, 0.60, 0.110, ALIGN_LEFT),
                SLOT_SUBTITLE: _slot(0.06, 0.75, 0.55, 0.045, ALIGN_LEFT),
                SLOT_FACT1: _slot(0.06, 0.82, 0.42, 0.048, ALIGN_LEFT),
                SLOT_FACT2: _slot(0.06, 0.89, 0.42, 0.048, ALIGN_LEFT),
            },
        },
    },
    COMPOSITION_RECRUITING: {
        ASPECT_PORTRAIT: {
            "photo": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.56},
            "slots": {
                SLOT_TITLE: _slot(0.5, 0.60, 0.90, 0.058, ALIGN_CENTER),
                SLOT_SUBTITLE: _slot(0.5, 0.665, 0.80, 0.028, ALIGN_CENTER),
                SLOT_FACT1: _slot(0.5, 0.72, 0.80, 0.032, ALIGN_CENTER),
                SLOT_FACT2: _slot(0.5, 0.79, 0.80, 0.032, ALIGN_CENTER),
                SLOT_FACT3: _slot(0.5, 0.86, 0.80, 0.032, ALIGN_CENTER),
            },
        },
        ASPECT_LANDSCAPE: {
            "photo": {"x": 0.0, "y": 0.0, "w": 0.46, "h": 1.0},
            "slots": {
                SLOT_TITLE: _slot(0.52, 0.20, 0.44, 0.095, ALIGN_LEFT),
                SLOT_SUBTITLE: _slot(0.52, 0.33, 0.42, 0.042, ALIGN_LEFT),
                SLOT_FACT1: _slot(0.52, 0.46, 0.42, 0.050, ALIGN_LEFT),
                SLOT_FACT2: _slot(0.52, 0.60, 0.42, 0.050, ALIGN_LEFT),
                SLOT_FACT3: _slot(0.52, 0.74, 0.42, 0.050, ALIGN_LEFT),
            },
        },
    },
}


# =============================================================================
# TREATMENT PALETTE  (treatment -> {background, accent, band, photoMood})
# =============================================================================
# A treatment must VISIBLY change the card even on a full-bleed photo, where the
# `background` is hidden (T6580 item 4 — the "changing Style barely changes
# anything" complaint). So each treatment OWNS four things, ALL here in the shared
# contract (never in the editor only) so the browser preview and the ffmpeg export
# render the same pixels:
#   - background : the radial/solid backdrop (hidden behind a full-bleed photo;
#     visible on `recruiting`'s inset). Encoded as endpoints + centre + extent so
#     both sides paint the same gradient (editor: CSS `radial-gradient`; engine:
#     ffmpeg `geq`, d = hypot((x-cx)/ex, (y-cy)/ey), stops lerped by
#     clip(d/lastStopPos, 0, 1)). `css` is the exact editor string, kept for a
#     1:1 check.
#   - accent     : the title's default colour.
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
    """Return `{photo, slots}` for a composition + aspect key. Unknown keys RAISE
    (a drift bug, never a silent fallback)."""
    try:
        return GEOMETRY[composition][aspect]
    except KeyError as e:
        raise KeyError(
            f"no intro card geometry for composition={composition!r} "
            f"aspect={aspect!r}"
        ) from e


def treatment_for(treatment: str) -> dict:
    """Return `{background, accent, band, photoMood}` for a treatment key. Unknown
    keys RAISE."""
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
# JS MIRROR GENERATION + PARITY
# =============================================================================
_JS_PATH = (
    Path(__file__).resolve().parents[4]
    / "src" / "frontend" / "src" / "utils" / "introCardGeometry.js"
)


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
    return f"""// GENERATED FROM app/services/intro_card_geometry.py — do not hand-edit.
// Regenerate: cd src/backend && .venv/Scripts/python.exe -m app.services.intro_card_geometry
// Parity is enforced by src/backend/tests/test_t5210_geometry_parity.py.
//
// Shared intro-card slot geometry + motion timing + treatment palette (T5210).
// See the Python module for the coordinate convention, the ordinal-geometry /
// semantic-styling mapping, and rationale. The editor (T5205) reads THESE numbers
// so its live preview + motion + treatment swatches match the render engine.

export const CARD_ASPECTS = /* @parity:aspects:start */ {aspects} /* @parity:aspects:end */;

export const INTRO_CARD_GEOMETRY = /* @parity:geometry:start */ {geometry} /* @parity:geometry:end */;

export const INTRO_CARD_TREATMENTS = /* @parity:treatments:start */ {treatments} /* @parity:treatments:end */;

export const INTRO_CARD_MOTION = /* @parity:motion:start */ {motion} /* @parity:motion:end */;

export const STAGGER_ORDER = /* @parity:staggerOrder:start */ {stagger} /* @parity:staggerOrder:end */;

export const BAND_COMPOSITIONS = /* @parity:bandCompositions:start */ {band_compositions} /* @parity:bandCompositions:end */;

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
 * `{{photo, slots}}` for a composition + aspect key. Throws on an unknown key
 * (a drift bug, never a silent fallback) to match the Python accessor.
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
 * `{{background, accent}}` for a treatment key. Throws on an unknown key.
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
    _JS_PATH.write_text(content, encoding="utf-8", newline="\n")
    return _JS_PATH


if __name__ == "__main__":
    path = write_js_mirror()
    print(f"wrote {path}")
