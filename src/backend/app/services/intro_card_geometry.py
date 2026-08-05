"""Intro card geometry + motion timing — the shared contract (T5210).

THE source of truth for two things the render engine (`player_intro.py`, this
task) and the browser editor/preview (`T5205`) must agree on to the pixel:

  1. **Slot geometry** — where the photo and each text element sit, per
     composition (`title-only` / `hero` / `broadcast` / `recruiting`) and per
     output aspect (`9:16` / `16:9`). Normalised 0..1 so ONE stored card frames
     identically at 1080x1920 and 1920x1080 and in a small browser preview box.
  2. **Motion timing** — the photo push-in, the per-element text stagger, and
     the white-flash EXIT into the footage. The same numbers the browser motion
     preview animates with; two copies would silently drift.

Python is the source of truth. `src/frontend/src/utils/introCardGeometry.js` is
a GENERATED mirror (regenerate with `python -m app.services.intro_card_geometry`)
that embeds the exact JSON below; `tests/test_t5210_geometry_parity.py` fails if
the two ever diverge. This is the same "one contract, both consumers, a parity
test proving they agree" shape T5180 uses for `fonts.json` / `text_render` /
`RichText`. The geometry deliberately does NOT live only inside a filtergraph
string — the editor has to read the same numbers (task file § Contract ownership).

Coordinate convention (mirrors the TextSpec unit invariant in schemas.py):
  - `x` and `w`/`maxWidth` are fractions of the output frame WIDTH.
  - `y`, `h` and `size` are fractions of the output frame HEIGHT.
  - A photo rect `{x, y, w, h}` is the region of the frame the framed photo
    fills; the card's `focal_x`/`focal_y`/`zoom` then frame the image WITHIN it,
    so the same stored framing works at both aspects (epic decision 3b).
  - A text slot `{x, y, maxWidth, size, align}` carries LAYOUT only. `x` is the
    anchor read per `align` (left edge / centre / right edge, exactly as
    TextSpec.position is), `y` is the block's TOP edge. The card's per-slot
    TextSpec supplies the STYLING (font, colour, weight, shadow, stroke) and the
    text; the engine merges the two into a full TextSpec before rendering. Font
    SIZE and POSITION are layout-owned (composition-derived), never stored on the
    card — that is what guarantees no empty slots and a consistent look.

Nothing here is stored on a card. Composition is derived from
(`has_photo`, `shown_fields`) via `intro_cards.derive_composition`; this module
only says how each derived composition is laid out.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.services.intro_cards import (
    COMPOSITION_BROADCAST,
    COMPOSITION_HERO,
    COMPOSITION_RECRUITING,
    COMPOSITION_TITLE_ONLY,
)

# Aspect keys. A card renders at whatever the target reel is; `9:16` covers every
# portrait output and `16:9` every landscape one (a square reel resolves to
# `16:9`, see `aspect_key`). These two strings are the only aspect keys in the
# contract — greppable, never computed.
ASPECT_PORTRAIT = "9:16"
ASPECT_LANDSCAPE = "16:9"

# Text slots. Positional: the free-text `title`/`subtitle` come from the card,
# and `fact1..fact3` are filled IN ORDER from the card's `shown_fields` (the i-th
# shown field -> `fact{i+1}`), with the VALUE read from the profile (epic
# decision 3). A composition only defines the slots it actually shows; a slot the
# card has no text/value for is omitted and logged, never drawn blank.
SLOT_TITLE = "title"
SLOT_SUBTITLE = "subtitle"
SLOT_FACT1 = "fact1"
SLOT_FACT2 = "fact2"
SLOT_FACT3 = "fact3"

ALIGN_LEFT = "left"
ALIGN_CENTER = "center"

# Full-bleed photo rect, reused where the photo backs the whole frame.
_FULL_BLEED = {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}


def _slot(x: float, y: float, max_width: float, size: float, align: str) -> dict:
    return {"x": x, "y": y, "maxWidth": max_width, "size": size, "align": align}


# =============================================================================
# SLOT GEOMETRY  (composition -> aspect -> {photo, slots})
# =============================================================================
# Values are a deliberate, reviewable proposal (T5210 design gate). Rationale:
#   - title-only : a text-forward card; the photo (if any) is a full-bleed,
#     scrimmed background, title + subtitle centred.
#   - hero       : the photo IS the card (full-bleed push-in); a name + one fact
#     sit in the lower third. 16:9 anchors the text left so the push-in subject
#     stays clear of it.
#   - broadcast  : full-bleed photo + a lower-third band; name + two facts.
#   - recruiting : the "profile" look — an INSET photo (top band at 9:16, left
#     column at 16:9) with a denser three-fact stack beside/below it. The inset
#     is what visually separates recruiting from broadcast.
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
# MOTION TIMING  (seconds, relative to the card timeline 0..duration)
# =============================================================================
# Card `duration` is stored per-card; these are the relative offsets both the
# renderer and the browser preview animate with. The stagger runs in slot ORDER
# (title, subtitle, fact1, fact2, fact3): element i begins at
# `textStaggerFirstSt + i * textStaggerStep`. The exit flash is the LAST beat, so
# the card's final frame is a deterministic white that cuts cleanly into the reel
# (mirrors T5240's flash, applied last for frame determinism).
MOTION: dict[str, float | int] = {
    # Photo Ken Burns push-in across the whole card, ease-out. Starts FROM the
    # card's stored focal framing (does not replace it).
    "photoPushInZoomStart": 1.0,
    "photoPushInZoomEnd": 1.12,
    # Per-element staggered fade-up.
    "textStaggerFirstSt": 0.35,
    "textStaggerStep": 0.16,
    "textFadeD": 0.45,
    # Elements rise this fraction of the frame height while fading in.
    "textRiseFrac": 0.02,
    # White flash EXIT into the footage (tail of the card).
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
    motion = json.dumps(c["motion"], indent=2, sort_keys=True)
    stagger = json.dumps(c["staggerOrder"])
    aspects = json.dumps(c["aspects"], indent=2, sort_keys=True)
    return f"""// GENERATED FROM app/services/intro_card_geometry.py — do not hand-edit.
// Regenerate: cd src/backend && .venv/Scripts/python.exe -m app.services.intro_card_geometry
// Parity is enforced by src/backend/tests/test_t5210_geometry_parity.py.
//
// Shared intro-card slot geometry + motion timing (T5210). See the Python module
// for the coordinate convention and rationale. The editor (T5205) reads THESE
// numbers so its live preview + motion match what the render engine produces.

export const CARD_ASPECTS = /* @parity:aspects:start */ {aspects} /* @parity:aspects:end */;

export const INTRO_CARD_GEOMETRY = /* @parity:geometry:start */ {geometry} /* @parity:geometry:end */;

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
"""


def write_js_mirror() -> Path:
    """Write the generated JS mirror to disk and return its path."""
    content = render_js_mirror()
    _JS_PATH.write_text(content, encoding="utf-8", newline="\n")
    return _JS_PATH


if __name__ == "__main__":
    path = write_js_mirror()
    print(f"wrote {path}")
