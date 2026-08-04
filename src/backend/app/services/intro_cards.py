"""Intro card library — shared rules for the card storage layer (T5195).

This module is the ONE place the backend derives an intro card's composition,
validates its stored fields, and serialises a DB row into an API payload. The
CRUD routes (`routers/intro_cards.py`), the render engine (T5210) and any other
server consumer read the SAME rule from here — the composition is never inlined
in two places (epic decision 2; CLAUDE.md refactoring rule: greppable, single
helper). The frontend mirrors `derive_composition` in
`src/frontend/src/utils/introCardComposition.js`; the two must stay in step.

Nothing here stores derived state. `composition` is computed on every read from
the canonical `(has_photo, shown_fields)`; there is deliberately NO
template/layout column (storing it would be redundant state that drifts the
first time a user removes the photo).
"""

from __future__ import annotations

from typing import Any

from app.schemas import TextSpec
from app.services.user_db import INTRO_FACT_FIELDS

# The facts a card may choose to show. Mirrors the profile's structured intro
# fields (epic decision 3) — the VALUES live on the profile; a card records only
# WHICH of them it displays. Imported from user_db so there is one definition.
SHOWN_FIELDS: tuple[str, ...] = INTRO_FACT_FIELDS  # ("position", "class", "team")

# Visual treatment is a SEPARATE axis from composition (epic decision 2b) — a
# 3-way toggle, not derived from field count.
TREATMENTS: frozenset[str] = frozenset({"gold", "dark", "photo-forward"})

# Composition values DERIVED from (has_photo, len(shown_fields)). Greppable
# string literals near their use (no computed dispatch).
COMPOSITION_TITLE_ONLY = "title-only"
COMPOSITION_HERO = "hero"
COMPOSITION_BROADCAST = "broadcast"
COMPOSITION_RECRUITING = "recruiting"

# Focal point is a normalised 0..1 coordinate; zoom is a multiplier. NULL on any
# of the three means "inherit the profile's framing" (epic decision 3b) — a
# distinct, valid value that must NOT be collapsed to a default at write time.
ZOOM_MIN = 1.0
ZOOM_MAX = 4.0

# Card play length, in seconds. Bounded so a negative/zero/absurd value can't be
# persisted silently (the reference intro is ~12s; 4.0 is the default). Out of
# range RAISES (400) rather than clamping bad data.
DURATION_MIN = 0.5
DURATION_MAX = 30.0


def derive_composition(has_photo: bool, shown_fields: list[str]) -> str:
    """Derive the card composition from what the user chose to show.

        no photo (or no facts) -> title-only
        photo + 1 fact          -> hero
        photo + 2 facts         -> broadcast
        photo + 3 facts         -> recruiting

    A photo with zero facts has nothing to lay out beside the title, so it is a
    title-only card (the photo still backs it). >3 facts is unreachable —
    `shown_fields` is validated to a 3-element subset — but clamps to recruiting
    rather than raising here, since this is a pure derivation, not a gate.
    """
    n = len(shown_fields)
    if not has_photo or n == 0:
        return COMPOSITION_TITLE_ONLY
    if n == 1:
        return COMPOSITION_HERO
    if n == 2:
        return COMPOSITION_BROADCAST
    return COMPOSITION_RECRUITING


def validate_shown_fields(value: Any) -> list[str]:
    """Coerce/validate a shown_fields payload to a de-duplicated, ordered subset
    of the known facts. Raises ValueError (-> 400) on any unknown field or a
    non-list — a typo must fail loudly, never render an empty line."""
    if not isinstance(value, list):
        raise ValueError("shown_fields must be a list")
    seen: list[str] = []
    for field in value:
        if field not in SHOWN_FIELDS:
            raise ValueError(
                f"unknown shown_field {field!r}; allowed: {sorted(SHOWN_FIELDS)}"
            )
        if field not in seen:
            seen.append(field)
    return seen


def validate_treatment(value: Any) -> str:
    """Validate `treatment` against the known 3-way set. Raises ValueError (400)."""
    if value not in TREATMENTS:
        raise ValueError(
            f"unknown treatment {value!r}; allowed: {sorted(TREATMENTS)}"
        )
    return value


def validate_text_elements(value: Any) -> dict[str, dict]:
    """Validate a ``{slot_name: TextSpec}`` mapping on the way in.

    Every value is parsed as a TextSpec (T5180) — an unknown font key or a
    malformed spec RAISES ValueError (-> 400), never stored and never silently
    repaired. Returns a plain-dict form (each spec dumped back to JSON-able
    primitives) ready for msgpack encoding on disk.
    """
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("text_elements must be an object of slot -> TextSpec")
    out: dict[str, dict] = {}
    for slot, spec in value.items():
        if not isinstance(slot, str):
            raise ValueError("text_elements slot names must be strings")
        try:
            parsed = TextSpec.model_validate(spec)
        except Exception as e:  # pydantic ValidationError -> 400
            raise ValueError(f"invalid TextSpec for slot {slot!r}: {e}") from e
        out[slot] = parsed.model_dump(mode="json")
    return out


def validate_focal(value: Any, name: str) -> float | None:
    """Validate a focal coordinate (focal_x/focal_y) in 0..1, or None (inherit).

    NULL is a distinct valid value meaning "inherit the profile's framing" — do
    NOT collapse it to a default. Out-of-range RAISES (400), never a silent clamp.
    """
    if value is None:
        return None
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{name} must be a number in 0..1 or null")
    if not (0.0 <= float(value) <= 1.0):
        raise ValueError(f"{name} must be within 0..1 (got {value})")
    return float(value)


def validate_duration(value: Any) -> float:
    """Validate `duration` (seconds) within a sane range. Unlike focal/zoom,
    duration has NO inherit semantics — it is always a concrete value (default
    4.0) — so None is rejected here too. Out of range RAISES (400)."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError("duration must be a number")
    if not (DURATION_MIN <= float(value) <= DURATION_MAX):
        raise ValueError(f"duration must be within {DURATION_MIN}..{DURATION_MAX} (got {value})")
    return float(value)


def validate_zoom(value: Any) -> float | None:
    """Validate `zoom` within a sane range, or None (inherit the profile framing).
    Out-of-range RAISES (400)."""
    if value is None:
        return None
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError("zoom must be a number or null")
    if not (ZOOM_MIN <= float(value) <= ZOOM_MAX):
        raise ValueError(f"zoom must be within {ZOOM_MIN}..{ZOOM_MAX} (got {value})")
    return float(value)
