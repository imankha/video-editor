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

NO BIOMETRICS (T5230 compliance): the intro pipeline never runs face
recognition / facial templating / biometric identifier extraction on the
minor's photo (2025 COPPA amendment + BIPA/CCPA). Composition is derived purely
from the count of parent-chosen facts, never from anything detected in the
image. Enforced by the static guardrail test in
`tests/test_t5230_intro_compliance.py`.
"""

from __future__ import annotations

import logging
from typing import Any

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
# Attachment resolution (T5215; simplified T6680) — ONE resolution order, used
# by every consumer (reel egress reads, `GET /api/downloads` list, collection
# share serve). Two implementations of this order is the single failure this
# task exists to prevent, so the reel path and the collection path both import
# from here. T6680 removed the "NULL inherits the profile default" branch —
# there is no profile default anymore, so NULL and 0 both resolve to no intro.
# ---------------------------------------------------------------------------

def resolve_intro_card_id(intro_card_id: int | None) -> int | None:
    """The SINGLE resolution order for an attachment value. Pure and read-only:
    never fabricates a card, never rewrites the caller's row.

      0              -> None      (explicit opt-out)
      <positive id>  -> that id   (explicit attach -- consent-gated at attach time)
      NULL           -> None      (no card attached -- there is no profile
                                    default to inherit; T6680 removed the
                                    inherit-the-default path entirely)
    """
    if intro_card_id == 0:
        return None
    if intro_card_id is not None:
        return intro_card_id
    return None


def _intro_cards_table_exists(cursor) -> bool:
    cursor.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='intro_cards'"
    )
    return cursor.fetchone() is not None


def intro_image_has_other_reference(
    cursor,
    user_id: str | None,
    profile_id: str,
    key: str | None,
    *,
    exclude_card_id: int | None = None,
    include_profile_key: bool = True,
) -> bool:
    """True when an R2 intro image ``key`` is still referenced by an owner OTHER
    than the one being deleted (T6650 shared-ownership guard).

    One R2 intro object can be pointed at by the PROFILE (``user.sqlite``'s
    ``intro_photo_key``) AND by any number of intro CARDS (``profile.sqlite``'s
    ``intro_cards.image_key``, seeded from the profile key on card create and
    copied again on duplicate). A delete triggered by ONE owner must never
    destroy the object while another owner still points at it — otherwise a
    card delete silently blanks the profile photo (and vice-versa).

    ``cursor`` is an open ``profile.sqlite`` cursor (the card table lives there).
    Callers name who is deleting:
      * card delete   -> ``exclude_card_id=<this card>``, ``include_profile_key=True``
        (the row may still be present; exclude it, and count the profile as an owner)
      * profile photo remove/replace -> ``include_profile_key=False``
        (the profile is the deleter; only cards count as other owners)
    """
    if not key:
        return False
    if include_profile_key:
        from app.services.user_db import get_intro_photo_key
        if get_intro_photo_key(user_id, profile_id) == key:
            return True
    if not _intro_cards_table_exists(cursor):
        return False
    sql = "SELECT 1 FROM intro_cards WHERE image_key = ?"
    params: list[Any] = [key]
    if exclude_card_id is not None:
        sql += " AND id != ?"
        params.append(exclude_card_id)
    sql += " LIMIT 1"
    cursor.execute(sql, params)
    return cursor.fetchone() is not None


def load_profile_cards(cursor) -> dict[int, dict]:
    """Batch-load ``{id: {'name': ..., 'has_photo': bool}}`` for every card on
    this profile, for no-N+1 list resolution (`GET /api/downloads`, T5215;
    `has_photo` added T5220 for the share-modal exposure notice, Scope F --
    same batched query). `is_default` is dropped from the projection (T6680) --
    nothing resolves via it anymore, so it is dead data.
    Empty dict on a below-v034 profile (table absent) -- never per-row queries."""
    if not _intro_cards_table_exists(cursor):
        return {}
    cursor.execute("SELECT id, name, image_key FROM intro_cards")
    return {
        row["id"]: {
            "name": row["name"],
            "has_photo": bool(row["image_key"]),
        }
        for row in cursor.fetchall()
    }


def resolve_intro_card(
    intro_card_id: int | None,
    reel_duration: float | None,
    profile_conn,
    *,
    reel_id: int | None = None,
):
    """DB-backed single-reel/collection resolution: applies
    `resolve_intro_card_id`, then fetches the resolved id's row. Read-only --
    no UPDATE, no fabrication.

    `reel_duration` is accepted for call-site compatibility (callers still
    have a reel/collection duration to hand) but no longer participates in
    resolution (T6680 removed the inherit-the-default duration gate -- there
    is no default left to gate).

    A dangling id (the resolved id no longer exists -- e.g. the card was
    deleted after a collection share froze it) logs a warning and resolves to
    None, exactly like the reel-delete-cascade counterpart in
    `routers/intro_cards.py`.
    """
    cursor = profile_conn.cursor()
    resolved_id = resolve_intro_card_id(intro_card_id)
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


# ---------------------------------------------------------------------------
# Collection-level attachment (T5215 round 2, 2026-08-06) -- a persistent
# attribute of the COLLECTION ITSELF, distinct from a collection SHARE's
# frozen-at-creation choice (routers/collections.py's `intro_card_id` on
# `CollectionDefinition`). A collection has no persisted row of its own
# (membership is evaluated LIVE, see `evaluate_collection_members`), so this
# reuses the existing per-profile `collection_settings(key, value)` sparse
# KV table (T3640, created v009 -- long before the v023 floor every live
# profile DB already sits at or above, so it needs NO column_exists guard,
# unlike every v024+ addition elsewhere in this task).
#
# RESOLUTION ORDER (explicit design call, mirrors the REEL behaviour at the
# collection's own level -- see T5215 round-2 report for the full rationale;
# simplified T6680, same as the reel path above):
#   - The collection's OWN resolved intro governs the collection's playback
#     experience. Per-MEMBER `final_videos.intro_card_id` attachments are NOT
#     consulted while inside a collection's playback context -- they remain
#     the deciding attachment ONLY when that same reel is watched standalone
#     (its own single-reel view/share). "Most specific level wins outright"
#     is exactly the reel rule (explicit id beats no attachment); applied one
#     level up, the collection's own setting is the specific level for a
#     collection VIEW, and per-member settings are simply out of scope there.
#     REVERSIBLE: nothing here prevents a future task from instead compositing
#     both if that turns out to be the wanted product behaviour -- flagged in
#     the round-2 report, not read from the epic (ambiguous there).
#   - There is no duration gate: T6680 removed the inherit-the-default path
#     (and T6850 removed the now-dead `intro_min_duration_seconds` setting
#     that used to govern it) -- an explicitly attached card always plays
#     regardless of the collection's total duration, exactly like the reel
#     path's `resolve_intro_card_id`.
#   - Rendering this (actually prepending the collection's resolved card) is
#     T5220's job, same as the reel side of this task -- T5215 only persists
#     the attachment + resolves it for display.

def collection_intro_settings_key(
    scope_type: str, *, game_id: int | None = None,
    tags: list[str] | None = None, aspect_ratio: str,
) -> str:
    """Canonical, stable identity string for a (scope, ratio) collection's OWN
    intro attachment. Mirrors `routers/collections.py::_canonical_definition`'s
    own scope/tags canonicalization (sorted tags) so the same collection
    always maps to the same key regardless of client-sent tag order.
    `aspect_ratio` is part of identity -- a game's 9:16 and 16:9 buckets are
    different member sets with potentially different intro choices, same as
    two separate `CollectionCard`s in the UI today.
    """
    if scope_type == "game":
        if game_id is None:
            raise ValueError("game scope requires game_id")
        base = f"game:{game_id}"
    elif scope_type == "mixes":
        base = "mixes"
    elif scope_type == "all":
        base = f"tags:{','.join(sorted(set(tags)))}" if tags else "all"
    else:
        raise ValueError(f"unknown collection scope_type {scope_type!r}")
    return f"intro:{base}:{aspect_ratio}"


def get_collection_intro_card_id(cursor, key: str) -> int | None:
    """Raw stored collection attachment: 0 (no intro) | None (no row =
    inherit the profile default) | <id> (explicit). Mirrors a reel's
    `final_videos.intro_card_id` semantics exactly, on collection_settings."""
    cursor.execute("SELECT value FROM collection_settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    if row is None or row["value"] in (None, ""):
        return None
    return int(row["value"])


def set_collection_intro_card_id(cursor, key: str, intro_card_id: int | None) -> None:
    """Surgical write (gesture: picker selection). `None` DELETEs the row
    (restores inherit -- an absent row IS the NULL state, never a stored
    empty-string sentinel); `0`/`<id>` upserts the concrete value."""
    if intro_card_id is None:
        cursor.execute("DELETE FROM collection_settings WHERE key = ?", (key,))
    else:
        cursor.execute(
            "INSERT INTO collection_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(intro_card_id)),
        )
