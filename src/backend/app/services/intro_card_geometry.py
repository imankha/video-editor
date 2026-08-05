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
        * title  -> the card's `title_text` column (free text; omit+log if blank)
        * factN  -> the PROFILE value for `shown_fields[N-1]` (omit+log if blank)
  - So the renderer walks:
        for i, field in enumerate(card["shown_fields"]):
            geo_slot = geometry.slots[f"fact{i+1}"]      # ORDINAL position
            styling  = card["text_elements"].get(field)  # SEMANTIC styling (may be None)
            value    = field_values.get(field)           # PROFILE value (omit if blank)
    and for the title: geo_slot = slots["title"], styling = text_elements.get("title"),
    text = card["title_text"].
  - There is deliberately NO `subtitle` slot: the shipped schema has only
    `title_text` (no subtitle column) and T5205 authors none. Adding one would be a
    migration, out of scope. See SLOT_* below.

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

# Text slots. `title` free text comes from the card's `title_text`; `fact1..fact3`
# are the ORDINAL fact-line positions, filled IN ORDER from the card's
# `shown_fields` with the VALUE read from the profile (see the mapping note above).
# There is NO subtitle slot — the shipped schema has no subtitle field.
SLOT_TITLE = "title"
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
# Approved values (T5210 design gate). The photo placement is what separates the
# four looks:
#   - title-only : a text-forward card; the photo (if any) is a full-bleed,
#     scrimmed background, the title centred.
#   - hero       : the photo IS the card (full-bleed push-in); a name + one fact
#     sit in the lower third. 16:9 anchors the text left so the subject stays clear.
#   - broadcast  : full-bleed photo + a lower-third band; name + two facts.
#   - recruiting : the "profile" look — an INSET photo (top band at 9:16, left
#     column at 16:9) with a denser three-fact stack beside/below it.
GEOMETRY: dict[str, dict[str, dict]] = {
    COMPOSITION_TITLE_ONLY: {
        ASPECT_PORTRAIT: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.5, 0.44, 0.86, 0.072, ALIGN_CENTER),
            },
        },
        ASPECT_LANDSCAPE: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.5, 0.42, 0.86, 0.135, ALIGN_CENTER),
            },
        },
    },
    COMPOSITION_HERO: {
        ASPECT_PORTRAIT: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.5, 0.74, 0.90, 0.066, ALIGN_CENTER),
                SLOT_FACT1: _slot(0.5, 0.84, 0.80, 0.034, ALIGN_CENTER),
            },
        },
        ASPECT_LANDSCAPE: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.06, 0.68, 0.62, 0.120, ALIGN_LEFT),
                SLOT_FACT1: _slot(0.06, 0.86, 0.55, 0.055, ALIGN_LEFT),
            },
        },
    },
    COMPOSITION_BROADCAST: {
        ASPECT_PORTRAIT: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.5, 0.68, 0.90, 0.062, ALIGN_CENTER),
                SLOT_FACT1: _slot(0.5, 0.79, 0.80, 0.030, ALIGN_CENTER),
                SLOT_FACT2: _slot(0.5, 0.845, 0.80, 0.030, ALIGN_CENTER),
            },
        },
        ASPECT_LANDSCAPE: {
            "photo": dict(_FULL_BLEED),
            "slots": {
                SLOT_TITLE: _slot(0.06, 0.64, 0.60, 0.110, ALIGN_LEFT),
                SLOT_FACT1: _slot(0.06, 0.82, 0.42, 0.048, ALIGN_LEFT),
                SLOT_FACT2: _slot(0.06, 0.89, 0.42, 0.048, ALIGN_LEFT),
            },
        },
    },
    COMPOSITION_RECRUITING: {
        ASPECT_PORTRAIT: {
            "photo": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.56},
            "slots": {
                SLOT_TITLE: _slot(0.5, 0.61, 0.90, 0.058, ALIGN_CENTER),
                SLOT_FACT1: _slot(0.5, 0.72, 0.80, 0.032, ALIGN_CENTER),
                SLOT_FACT2: _slot(0.5, 0.79, 0.80, 0.032, ALIGN_CENTER),
                SLOT_FACT3: _slot(0.5, 0.86, 0.80, 0.032, ALIGN_CENTER),
            },
        },
        ASPECT_LANDSCAPE: {
            "photo": {"x": 0.0, "y": 0.0, "w": 0.46, "h": 1.0},
            "slots": {
                SLOT_TITLE: _slot(0.52, 0.22, 0.44, 0.095, ALIGN_LEFT),
                SLOT_FACT1: _slot(0.52, 0.46, 0.42, 0.050, ALIGN_LEFT),
                SLOT_FACT2: _slot(0.52, 0.60, 0.42, 0.050, ALIGN_LEFT),
                SLOT_FACT3: _slot(0.52, 0.74, 0.42, 0.050, ALIGN_LEFT),
            },
        },
    },
}


# =============================================================================
# TREATMENT PALETTE  (treatment -> {background, accent})
# =============================================================================
# Adopted verbatim from T5205's introCardEditorConstants.js so the editor's look
# is unchanged — this makes them canonical. The background is either a `solid`
# colour or a `radial` gradient; a gradient is encoded as endpoints + centre +
# extent (NOT flattened to one colour) so BOTH sides render the same pixels:
#   - the editor rebuilds the CSS `radial-gradient(...)` from these fields (the
#     `css` field is the exact string it already uses, kept for a 1:1 check);
#   - the render engine paints it with ffmpeg `geq`, computing the same normalised
#     radial distance d = hypot((x-cx)/ex, (y-cy)/ey) and lerping the stops by
#     clip(d / lastStopPos, 0, 1). `center`/`extent` are fractions of frame w/h;
#     `pos` is the CSS stop position (0..1 of the radius).
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
    },
    TREATMENT_PHOTO_FORWARD: {
        "background": {
            "type": "solid",
            "color": "#04060a",
            "css": "#04060a",
        },
        "accent": "#ffffff",
    },
}


# =============================================================================
# MOTION TIMING  (seconds, relative to the card timeline 0..duration)
# =============================================================================
# Card `duration` is stored per-card; these are the relative offsets both the
# renderer and the browser preview animate with. The stagger runs in slot ORDER
# (title, fact1, fact2, fact3): element i begins at `firstSt + i*step`. The exit
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

# The slot order the stagger walks (no subtitle). Shared so the preview and the
# renderer index the stagger identically.
STAGGER_ORDER: tuple[str, ...] = (
    SLOT_TITLE,
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
    """Return `{background, accent}` for a treatment key. Unknown keys RAISE."""
    try:
        return TREATMENTS_CONTRACT[treatment]
    except KeyError as e:
        raise KeyError(f"unknown treatment {treatment!r}") from e


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
"""


def write_js_mirror() -> Path:
    """Write the generated JS mirror to disk and return its path."""
    content = render_js_mirror()
    _JS_PATH.write_text(content, encoding="utf-8", newline="\n")
    return _JS_PATH


if __name__ == "__main__":
    path = write_js_mirror()
    print(f"wrote {path}")
