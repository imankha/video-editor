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

import logging
from typing import Any

from app.database import column_exists
from app.schemas import TextSpec
from app.services.user_db import INTRO_FACT_FIELDS

logger = logging.getLogger(__name__)

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


# ---------------------------------------------------------------------------
# Attachment resolution (T5215) — ONE resolution order, used by every consumer
# (reel egress reads, `GET /api/downloads` list, collection share serve). Two
# implementations of this order is the single failure this task exists to
# prevent, so the reel path and the collection path both import from here.
# ---------------------------------------------------------------------------

# Per-profile default for the duration gate (epic decision 2026-08-06); the
# real stored value lives on `user_settings.intro_min_duration_seconds`
# (profile_db v037) and is only ever missing in the deploy->migrate window or
# on a legacy row, both of which degrade to this constant.
DEFAULT_INTRO_MIN_DURATION_SECONDS = 20.0

# Bounds for the user-editable threshold. Upper bound is generous for any real
# reel while still catching a typo that would silently disable intros
# profile-wide; out-of-range RAISES rather than clamps (never a silent fix).
INTRO_MIN_DURATION_LOWER = 0.0  # exclusive
INTRO_MIN_DURATION_UPPER = 300.0  # inclusive


def resolve_intro_card_id(
    intro_card_id: int | None,
    reel_duration: float | None,
    default_id: int | None,
    min_duration: float,
    *,
    reel_id: int | None = None,
) -> int | None:
    """The SINGLE resolution order for an attachment value. Pure (no DB, no I/O
    besides the warning log below) and read-only: never fabricates a card,
    never rewrites the caller's row.

      0                      -> None            (opted THIS reel/collection out, at ANY duration)
      <positive id>          -> that id         (ALWAYS -- an explicit pick is never duration-gated)
      NULL (inherit default) -> default_id       IF reel_duration is known and >= min_duration
                              -> None             otherwise (short reel, or unknown duration)

    `reel_duration` missing (None) while inheriting the default is treated as
    "unknown -> no intro" (fail closed, matching the "short reels probably
    don't want one" bias) -- but a NULL `final_videos.duration` on OUR OWN row
    is an internal data bug, not an expected external state, so it is logged
    at WARNING (with `reel_id` when the caller has one), exactly like the
    dangling-card-id case below. It is never silently substituted and the row
    is never self-repaired.
    """
    if intro_card_id == 0:
        return None
    if intro_card_id is not None:
        return intro_card_id
    # Inherit-the-default path -- the only branch the duration gate governs.
    if reel_duration is None:
        logger.warning(
            "[intro] reel id=%s has no duration on its own final_videos row "
            "(internal data bug) -- resolving inherit-the-default to no-intro "
            "rather than guessing",
            reel_id,
        )
        return None
    if reel_duration >= min_duration:
        return default_id
    return None


def _intro_cards_table_exists(cursor) -> bool:
    cursor.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='intro_cards'"
    )
    return cursor.fetchone() is not None


def get_default_intro_card(cursor):
    """The profile's default card row, or None if none is marked default or the
    `intro_cards` table doesn't exist yet (deploy->migrate window, pre-v034)."""
    if not _intro_cards_table_exists(cursor):
        return None
    cursor.execute("SELECT * FROM intro_cards WHERE is_default = 1 LIMIT 1")
    return cursor.fetchone()


def get_intro_min_duration(cursor) -> float:
    """The profile's minimum-reel-duration threshold for the inherit-the-default
    resolution path (T5215). Column-guarded (v037 deploy->migrate window) and
    guarded again for a missing/legacy row -- both degrade to
    `DEFAULT_INTRO_MIN_DURATION_SECONDS`, never a crash."""
    if not column_exists(cursor, "user_settings", "intro_min_duration_seconds"):
        return DEFAULT_INTRO_MIN_DURATION_SECONDS
    cursor.execute("SELECT intro_min_duration_seconds FROM user_settings WHERE id = 1")
    row = cursor.fetchone()
    if row is None or row["intro_min_duration_seconds"] is None:
        return DEFAULT_INTRO_MIN_DURATION_SECONDS
    return float(row["intro_min_duration_seconds"])


def validate_intro_min_duration(value: Any) -> float:
    """Validate the per-profile minimum-reel-duration threshold (seconds).
    `0 < value <= 300`. Out-of-range or non-numeric RAISES ValueError (-> 400)
    -- never clamped silently (a typo here would silently misconfigure intros
    profile-wide)."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError("intro_min_duration_seconds must be a number")
    v = float(value)
    if not (INTRO_MIN_DURATION_LOWER < v <= INTRO_MIN_DURATION_UPPER):
        raise ValueError(
            f"intro_min_duration_seconds must be within "
            f"({INTRO_MIN_DURATION_LOWER}, {INTRO_MIN_DURATION_UPPER}] (got {value})"
        )
    return v


def load_profile_cards(cursor) -> dict[int, dict]:
    """Batch-load ``{id: {'name': ..., 'is_default': bool}}`` for every card on
    this profile, for no-N+1 list resolution (`GET /api/downloads`, T5215).
    Empty dict on a below-v034 profile (table absent) -- never per-row queries."""
    if not _intro_cards_table_exists(cursor):
        return {}
    cursor.execute("SELECT id, name, is_default FROM intro_cards")
    return {
        row["id"]: {"name": row["name"], "is_default": bool(row["is_default"])}
        for row in cursor.fetchall()
    }


def resolve_intro_card(
    intro_card_id: int | None,
    reel_duration: float | None,
    profile_conn,
    *,
    reel_id: int | None = None,
):
    """DB-backed single-reel/collection resolution: loads this profile's
    default card + duration threshold, applies `resolve_intro_card_id`, then
    fetches the resolved id's row. Read-only -- no UPDATE, no fabrication.

    A dangling id (the resolved id no longer exists -- e.g. the card was
    deleted after a collection share froze it) logs a warning and resolves to
    None, exactly like the reel-delete-cascade counterpart in
    `routers/intro_cards.py`.
    """
    cursor = profile_conn.cursor()
    default_row = get_default_intro_card(cursor)
    default_id = default_row["id"] if default_row is not None else None
    min_duration = get_intro_min_duration(cursor)

    resolved_id = resolve_intro_card_id(
        intro_card_id, reel_duration, default_id, min_duration, reel_id=reel_id,
    )
    if resolved_id is None:
        return None

    cursor.execute("SELECT * FROM intro_cards WHERE id = ?", (resolved_id,))
    row = cursor.fetchone()
    if row is None:
        logger.warning(
            "[intro] reel/collection references missing intro_card id=%s "
            "(reel_id=%s) -- resolving to no-intro",
            resolved_id, reel_id,
        )
        return None
    return row
