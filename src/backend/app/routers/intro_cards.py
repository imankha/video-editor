"""Intro card library CRUD (T5195).

Session + profile scoped: every route operates on the CURRENT profile's
`profile.sqlite` (resolved from the `X-Profile-ID` header via
`get_db_connection`), so there is no profile id in the path. Writes ride the
normal per-profile R2 DB sync (TrackedConnection → middleware), and each traces
to a named editor gesture (create card, rename, set default, delete).

Storage-layer only — no editor UI (T5205) and no rendering (T5210). The shared
composition/validation rules live in `app/services/intro_cards.py`; this router
never inlines them.

CHILDREN'S-DATA COMPLIANCE (T5230): an intro card holds a minor's likeness and
parent-typed facts that become publicly visible when shared, so two guardrails
bind every card path here:
  1. NO BIOMETRICS, EVER. Nothing in the intro pipeline may run face
     recognition, facial templating, or any biometric identifier extraction on
     the photo (2025 COPPA amendment + BIPA/CCPA). The player cut-out (T5200)
     is background SEGMENTATION, not recognition — that is the only image
     analysis permitted. Enforced by the static guardrail test
     `test_t5230_intro_compliance.py::test_no_face_recognition_in_intro_pipeline`.
  2. CONSENT GATE. Card creation (`create_intro_card` below) is blocked (403)
     until the profile has a parental-consent attestation (`intro_consent_at`,
     T5190); attach-time gates live in downloads/collections (also 403). The raw
     photo upload (`profiles.upload_intro_image`) is intentionally NOT gated:
     per EPIC.md § Compliance posture the risk is PUBLIC EXPOSURE, not storage —
     the photo sits in a private per-profile R2 prefix (SSE + access control)
     and only becomes shareable once a card is created (gated here) and attached
     (gated in downloads/collections).
"""

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import column_exists, get_db_connection
from app.profile_context import get_current_profile_id
from app.services.intro_cards import (
    derive_composition,
    validate_duration,
    validate_focal,
    validate_shown_fields,
    validate_treatment,
    validate_zoom,
)
from app.services.intro_media import delete_intro_image
from app.services.user_db import get_intro_consent
from app.storage import generate_presigned_url_global
from app.user_context import get_current_user_id
from app.utils.encoding import decode_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/intro-cards", tags=["intro-cards"])


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class CreateIntroCardRequest(BaseModel):
    name: str
    treatment: str
    shown_fields: list[str] = []
    title_text: str | None = None
    # Free-text card subtitle (T6570) — a property of THIS card (e.g. a
    # tournament name), unlike the title which is the profile's Full Name.
    subtitle_text: str | None = None
    image_key: str | None = None
    image_cutout_key: str | None = None
    focal_x: float | None = None
    focal_y: float | None = None
    zoom: float | None = None
    duration: float = 4.0


class UpdateIntroCardRequest(BaseModel):
    """Surgical update — the client sends ONLY the changed field(s). Every field
    is optional; `model_fields_set` distinguishes "not sent" (leave untouched)
    from an explicit `null` (set to NULL = inherit), so the NULL-vs-value
    discipline on focal_x/focal_y/zoom is preserved."""
    name: str | None = None
    treatment: str | None = None
    shown_fields: list[str] | None = None
    title_text: str | None = None
    subtitle_text: str | None = None
    image_key: str | None = None
    image_cutout_key: str | None = None
    focal_x: float | None = None
    focal_y: float | None = None
    zoom: float | None = None
    duration: float | None = None


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------

def _table_missing(cursor) -> bool:
    """True when `intro_cards` does not exist yet (below-head profile DB in the
    deploy→migrate window). A hot read must return empty, never 500."""
    cursor.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='intro_cards'"
    )
    return cursor.fetchone() is None


def _has_subtitle_column(cursor) -> bool:
    """True when `intro_cards.subtitle_text` exists (T6570 / migration v035).

    Column-guards BOTH the read and the write for the deploy→migrate window: a
    below-head profile DB has the v034 table WITHOUT this column, so a hot read
    (`_serialize`) must not `row["subtitle_text"]`-KeyError and a write must not
    reference a missing column (the T6550 unguarded-write class — do not repeat
    it). PRAGMA rows are indexed positionally (row[1] == column name)."""
    cursor.execute("PRAGMA table_info(intro_cards)")
    return any(r[1] == "subtitle_text" for r in cursor.fetchall())


def _serialize(row) -> dict:
    """Map a DB row to an API payload. `composition` is DERIVED here (never
    stored); `previewUrl` is presigned at read time (never stored presigned)."""
    shown_fields = json.loads(row["shown_fields"]) if row["shown_fields"] else []
    image_key = row["image_key"]
    return {
        "id": row["id"],
        "name": row["name"],
        "shown_fields": shown_fields,
        "treatment": row["treatment"],
        "title_text": row["title_text"],
        # Column-guarded (T6570 / v035): a below-head DB lacks this column, so
        # read it only when present — otherwise None (no subtitle), never a 500.
        # NB: keep `.keys()` — `in` on a sqlite3.Row tests VALUES, not columns.
        "subtitle_text": (row["subtitle_text"] if "subtitle_text" in row.keys() else None),  # noqa: SIM118
        "image_key": image_key,
        "image_cutout_key": row["image_cutout_key"],
        "focal_x": row["focal_x"],
        "focal_y": row["focal_y"],
        "zoom": row["zoom"],
        "text_elements": decode_data(row["text_elements"]) or {},
        "duration": row["duration"],
        # T6680: is_default retired end-to-end -- nothing resolves via it
        # anymore, so it is dropped from the API payload (the column itself
        # stays in the schema as harmless dead data; see services/intro_cards.py).
        # Derived, computed on every read (epic decision 2). Not a stored column.
        "composition": derive_composition(bool(image_key), shown_fields),
        "previewUrl": generate_presigned_url_global(image_key) if image_key else None,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _fetch_card(cursor, card_id: int):
    cursor.execute("SELECT * FROM intro_cards WHERE id = ?", (card_id,))
    return cursor.fetchone()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("")
async def list_intro_cards():
    """List the current profile's intro cards (raw rows + derived composition +
    a freshly presigned preview URL)."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        if _table_missing(cursor):
            # Below-head DB (migration not yet run): no cards exist. Empty, not 500.
            return {"cards": []}
        cursor.execute("SELECT * FROM intro_cards ORDER BY created_at DESC, id DESC")
        rows = cursor.fetchall()
    return {"cards": [_serialize(r) for r in rows]}


@router.post("")
async def create_intro_card(request: CreateIntroCardRequest):
    """Create a card and return the stored row.

    T6680: the `is_default` concept is retired end-to-end — creating a card
    never touches it (there is no profile default to provision, and nothing
    reads it for resolution anymore). The column stays in the schema as
    harmless dead data (see `services/intro_cards.py` module comment).

    T5230 consent gate: a card is a minor's likeness + parent-typed facts made
    shareable, so creation is refused (403, never a silent no-op) until the
    profile has a recorded parental-consent attestation (`intro_consent_at`,
    T5190). 403 (not 400) matches the pre-existing attach-time gates in
    downloads/collections — the whole consent surface fails the same way, so the
    frontend handles one status. (The raw photo upload is intentionally not
    gated — see the module docstring: storage in a private prefix is not the
    exposure risk; card creation is the first point that leads to sharing.)
    """
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()
    if get_intro_consent(user_id, profile_id) is None:
        raise HTTPException(
            status_code=403,
            detail=(
                "Parental consent is required before creating an intro card. "
                "The parent or guardian must attest to using this player's likeness."
            ),
        )

    try:
        shown_fields = validate_shown_fields(request.shown_fields)
        treatment = validate_treatment(request.treatment)
        focal_x = validate_focal(request.focal_x, "focal_x")
        focal_y = validate_focal(request.focal_y, "focal_y")
        zoom = validate_zoom(request.zoom)
        duration = validate_duration(request.duration)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if not request.name or not request.name.strip():
        raise HTTPException(status_code=400, detail="name is required")

    with get_db_connection() as conn:
        cursor = conn.cursor()
        columns = ["name", "shown_fields", "treatment", "title_text", "image_key",
                   "image_cutout_key", "focal_x", "focal_y", "zoom", "duration"]
        values = [request.name.strip(), json.dumps(shown_fields), treatment,
                  request.title_text, request.image_key, request.image_cutout_key,
                  focal_x, focal_y, zoom, duration]
        # Column-guarded WRITE (T6570 / v035, T6550 lesson): only write the
        # subtitle when the column exists; below-head DBs create the card without
        # it rather than 500ing.
        if _has_subtitle_column(cursor):
            columns.append("subtitle_text")
            values.append(request.subtitle_text)
        placeholders = ", ".join(["?"] * len(columns))
        cursor.execute(
            f"INSERT INTO intro_cards ({', '.join(columns)}) VALUES ({placeholders})",
            values,
        )
        card_id = cursor.lastrowid
        conn.commit()
        row = _fetch_card(cursor, card_id)

    logger.info(f"Created intro card {card_id} for profile {get_current_profile_id()}")
    return _serialize(row)


# Which request fields map to which validated column value. Each entry is a
# (column, validator) pair; the validator raises ValueError -> 400 on bad input.
_UPDATABLE_FIELDS = {
    "name": ("name", lambda v: v if (v and v.strip()) else _raise("name cannot be empty")),
    "treatment": ("treatment", validate_treatment),
    "shown_fields": ("shown_fields", lambda v: json.dumps(validate_shown_fields(v))),
    "title_text": ("title_text", lambda v: v),
    "subtitle_text": ("subtitle_text", lambda v: v),
    "image_key": ("image_key", lambda v: v),
    "image_cutout_key": ("image_cutout_key", lambda v: v),
    "focal_x": ("focal_x", lambda v: validate_focal(v, "focal_x")),
    "focal_y": ("focal_y", lambda v: validate_focal(v, "focal_y")),
    "zoom": ("zoom", validate_zoom),
    "duration": ("duration", validate_duration),
}


def _raise(msg: str):
    raise ValueError(msg)


@router.patch("/{card_id}")
async def update_intro_card(card_id: int, request: UpdateIntroCardRequest):
    """Surgical update: build the SET clause from ONLY the fields the client
    actually sent (`model_fields_set`), so the write touches one changed field
    and an explicit `null` is honoured (focal/zoom NULL = inherit) while an
    absent field is left untouched."""
    provided = request.model_fields_set
    if not provided:
        raise HTTPException(status_code=400, detail="no fields to update")

    updates: dict[str, Any] = {}  # column -> validated value
    try:
        for field in provided:
            column, validator = _UPDATABLE_FIELDS[field]
            updates[column] = validator(getattr(request, field))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    with get_db_connection() as conn:
        cursor = conn.cursor()
        if _table_missing(cursor) or _fetch_card(cursor, card_id) is None:
            raise HTTPException(status_code=404, detail="intro card not found")
        # Column-guarded WRITE (T6570 / v035, T6550 lesson): drop a subtitle write
        # on a below-head DB rather than referencing a missing column and 500ing.
        if "subtitle_text" in updates and not _has_subtitle_column(cursor):
            del updates["subtitle_text"]
            logger.warning(
                "[intro_cards] subtitle_text write skipped: column not present yet (pre-v035)"
            )
        set_columns = [f"{c} = ?" for c in updates]
        set_columns.append("updated_at = datetime('now')")
        cursor.execute(
            f"UPDATE intro_cards SET {', '.join(set_columns)} WHERE id = ?",
            (*updates.values(), card_id),
        )
        conn.commit()
        row = _fetch_card(cursor, card_id)

    return _serialize(row)


@router.delete("/{card_id}")
async def delete_intro_card(card_id: int):
    """Delete a card, its R2 image, and clear any reels pointing at it.

    In ONE transaction: null out `final_videos.intro_card_id` for reels that
    reference this card (so a dangling id is never left behind — resolution
    already degrades a dangling id to no-intro, but the write is cleaned up
    here rather than left dangling) and delete the row. T6680 retired the
    `is_default` promotion that used to run here — there is no profile default
    concept left to maintain. The R2 image is removed after the DB commit (a
    leaked object is a lesser evil than a row pointing at a 404, and T5230's
    purge is a backstop).

    The UPDATE naming `intro_card_id` is column_exists-guarded (deploy→migrate
    window discipline), and the guard is LOAD-BEARING: `ensure_database()`
    creates the `intro_cards` table independently of the v034 migration, so an
    existing below-head profile can hold intro_cards rows (created via this API)
    while `final_videos.intro_card_id` is still absent until v034 runs. Naming
    the column unguarded there would 500 the delete.
    """
    user_id = get_current_user_id()
    profile_id = get_current_profile_id()

    with get_db_connection() as conn:
        cursor = conn.cursor()
        if _table_missing(cursor):
            raise HTTPException(status_code=404, detail="intro card not found")
        row = _fetch_card(cursor, card_id)
        if row is None:
            raise HTTPException(status_code=404, detail="intro card not found")
        image_key = row["image_key"]

        # Same transaction: detach referencing reels, then delete the card.
        if column_exists(cursor, "final_videos", "intro_card_id"):
            cursor.execute(
                "UPDATE final_videos SET intro_card_id = NULL WHERE intro_card_id = ?",
                (card_id,),
            )
        cursor.execute("DELETE FROM intro_cards WHERE id = ?", (card_id,))
        conn.commit()

    # R2 image removal is a best-effort side effect after the row is gone.
    if image_key:
        try:
            delete_intro_image(user_id, profile_id, image_key)
        except ValueError:
            # Key not under this profile's intro/ prefix (e.g. a legacy/foreign
            # key). Log and move on — the row is already deleted.
            logger.warning(
                f"Intro card {card_id} image_key not deletable (foreign prefix): {image_key}"
            )

    logger.info(f"Deleted intro card {card_id} for profile {profile_id}")
    return {"success": True}
