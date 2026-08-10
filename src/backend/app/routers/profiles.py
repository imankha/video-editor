"""
Profile CRUD and switching endpoints.

Each profile gets its own database, clips, projects, and exports.
Games are shared across profiles (global via T80).
Profile metadata is stored in user.sqlite (source of truth).

Endpoints:
    GET    /api/profiles          - List all profiles
    POST   /api/profiles          - Create new profile
    PUT    /api/profiles/current  - Switch active profile
    PUT    /api/profiles/{id}     - Update profile (name, color)
    DELETE /api/profiles/{id}     - Delete profile + all its data
"""

import logging
from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.middleware.db_sync import DURABLE_SYNC_FAILED_RESPONSE, durable_sync
from app.profile_context import set_current_profile_id
from app.services.intro_cards import (
    get_intro_min_duration,
    intro_image_has_other_reference,
    validate_intro_min_duration,
)
from app.services.intro_media import (
    InvalidImageError,
    delete_intro_image,
    store_intro_image,
)
from app.services.user_db import (
    INTRO_FACT_FIELDS,
    clear_intro_consent,
    clear_intro_fact,
    clear_intro_photo_key,
    get_all_intro_consents,
    get_all_intro_facts,
    get_all_intro_full_names,
    get_all_intro_photo_keys,
    get_intro_photo_key,
    get_profiles,
    get_selected_profile_id,
    set_default_profile,
    set_intro_consent,
    set_intro_fact,
    set_intro_photo_key,
    set_selected_profile_id,
)
from app.services.user_db import (
    create_profile as db_create_profile,
)
from app.services.user_db import (
    delete_profile as db_delete_profile,
)
from app.services.user_db import (
    update_profile as db_update_profile,
)
from app.session_init import invalidate_user_cache
from app.storage import (
    delete_local_profile_data,
    delete_profile_r2_data,
    generate_presigned_url_global,
)
from app.user_context import get_current_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


# ---------------------------------------------------------------------------
# Request/Response Models
# ---------------------------------------------------------------------------

class CreateProfileRequest(BaseModel):
    name: str
    color: str
    sport: str | None = None


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    color: str | None = None
    sport: str | None = None


class SwitchProfileRequest(BaseModel):
    profileId: str


class DeleteIntroImageRequest(BaseModel):
    key: str


class UpdateIntroFactRequest(BaseModel):
    # position/class/team drive the composition; full_name is the card TITLE
    # source (T6570) -- same KV write path, but NOT a composition fact.
    field: Literal["position", "class", "team", "full_name"]
    value: str | None = None


def _intro_photo_fields(key: str | None) -> dict:
    """Presign a stored intro photo key at READ time (never store a presigned
    URL — R2 presigned URLs expire, so caching one would go stale). Returns
    {"introPhotoKey": None, "introPhotoUrl": None} when no photo is stored."""
    if not key:
        return {"introPhotoKey": None, "introPhotoUrl": None}
    return {"introPhotoKey": key, "introPhotoUrl": generate_presigned_url_global(key)}


def _intro_fact_fields(facts: dict) -> dict:
    """{"position": ..., "class": ..., "team": ...}, None for any unset field.

    `facts` is this profile's slice of get_all_intro_facts() -- {} when the
    profile has never set any fact.
    """
    return {field: facts.get(field) for field in INTRO_FACT_FIELDS}


def _require_owned_profile(user_id: str, profile_id: str) -> None:
    """404 unless profile_id is one of the current user's profiles.

    Keeps every intro endpoint scoped to the caller's own namespace — a user can
    never read or write another user's (or a non-existent) profile prefix.
    """
    if profile_id not in {p["id"] for p in get_profiles(user_id)}:
        raise HTTPException(status_code=404, detail="Profile not found")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_profiles():
    """List all profiles for the current user.

    Reads from user.sqlite (source of truth since T960).
    """
    user_id = get_current_user_id()
    profiles = get_profiles(user_id)
    selected = get_selected_profile_id(user_id)
    # Per-profile parental-consent attestation (T5190). Read once from the same
    # user.sqlite that backs the profiles list, then exposed as introConsentAt
    # so T5215 can gate intro attach on it (null = not consented / revoked).
    consents = get_all_intro_consents(user_id)
    photo_keys = get_all_intro_photo_keys(user_id)
    # Structured intro facts (T5190 follow-up, epic decision 3 reversal): drive
    # the card layout T5195/T5210 derive from field COUNT, so they must ride the
    # same payload as consent/photo rather than a separate fetch.
    facts = get_all_intro_facts(user_id)
    # The card title source (T6570) rides the same payload as the facts.
    full_names = get_all_intro_full_names(user_id)

    return {"profiles": [
        {
            "id": p["id"],
            "name": p["name"],
            "color": p["color"],
            "sport": p["sport"],
            "isDefault": bool(p["is_default"]),
            "isCurrent": p["id"] == selected,
            "introConsentAt": consents.get(p["id"]),
            "full_name": full_names.get(p["id"]),
            **_intro_photo_fields(photo_keys.get(p["id"])),
            **_intro_fact_fields(facts.get(p["id"], {})),
        }
        for p in profiles
    ]}


@router.post("")
async def create_profile(
    request: CreateProfileRequest,
    _durable: None = Depends(durable_sync),  # T5310: sync user.sqlite registry to R2 before 200
):
    """Create a new profile.

    Writes to user.sqlite (source of truth, synced to R2 automatically).

    T5310 durability: the new profile.sqlite is durably synced to R2 BEFORE its
    registry row is written to user.sqlite, and `Depends(durable_sync)` then makes
    the middleware AWAIT the user.sqlite (registry) R2 sync inside the write lock.
    A profile is therefore never REGISTERED without its R2 object existing. This
    closes the create-without-durable-sync race that lost 2 of arshia's profiles on
    prod (registry rows present, no R2 profile.sqlite) when a second profile was
    created seconds after the first and its fire-and-forget sync was lost.
    """
    user_id = get_current_user_id()
    profiles = get_profiles(user_id)

    # Check for duplicate name (case-insensitive)
    existing_names = [p["name"].lower() for p in profiles if p["name"]]
    if request.name.strip().lower() in existing_names:
        raise HTTPException(status_code=409, detail="A profile with this name already exists")

    new_id = uuid4().hex[:8]
    name = request.name.strip()
    sport = request.sport or "soccer"

    # T5310: create the new profile.sqlite locally and durably push it to R2 FIRST,
    # before the registry row is written. Ordering the object sync ahead of the
    # registration means a mid-op machine death yields at worst a benign R2 orphan
    # (a profile dir with no registry row — the Direction-B class the migration
    # runner already tolerates), never a "missing" registered profile (Direction A).
    set_current_profile_id(new_id)
    from app.database import ensure_database, sync_db_to_r2_explicit
    ensure_database()  # create local profile.sqlite for the new profile
    # T4310: sync_db_to_r2_explicit defaults to CAS ON (skip_version_check=False),
    # but this call is synchronous on the request thread (not asyncio.to_thread) —
    # skip_version_check=True here preserves the T1020/T2720 no-HEAD-on-request
    # guarantee. A brand-new profile has no prior R2 object to conflict with anyway.
    if not sync_db_to_r2_explicit(user_id, new_id, skip_version_check=True):
        logger.warning(
            f"[Profiles] durable R2 sync of new profile.sqlite FAILED for "
            f"user={user_id} profile={new_id} — not registering; returning 503"
        )
        # Same top-level {code, retryable} shape the middleware durable path emits,
        # so the frontend's `error.code === 'sync_failed'` retry handling applies.
        return JSONResponse(status_code=503, content=DURABLE_SYNC_FAILED_RESPONSE)

    # Profile object is now durable in R2 -> register it. Depends(durable_sync) makes
    # the middleware AWAIT the user.sqlite (registry) R2 sync and 503 on failure.
    db_create_profile(user_id, new_id, name, request.color, sport=sport)
    set_selected_profile_id(user_id, new_id)

    invalidate_user_cache(user_id)

    logger.info(f"Created profile {new_id} ({name}) for user {user_id}")

    return {"id": new_id, "name": name, "color": request.color, "sport": sport}


@router.put("/current")
async def switch_profile(request: SwitchProfileRequest):
    """Switch the active profile.

    Updates user.sqlite (source of truth, synced to R2 automatically).
    """
    user_id = get_current_user_id()
    profiles = get_profiles(user_id)
    profile_ids = {p["id"] for p in profiles}

    if request.profileId not in profile_ids:
        raise HTTPException(status_code=404, detail="Profile not found")

    set_selected_profile_id(user_id, request.profileId)
    invalidate_user_cache(user_id)

    # Ensure the new profile's DB exists locally
    set_current_profile_id(request.profileId)
    from app.database import ensure_database
    ensure_database()

    logger.info(f"Switched to profile {request.profileId} for user {user_id}")

    return {"profileId": request.profileId}


class UpdateIntroMinDurationRequest(BaseModel):
    intro_min_duration_seconds: float


@router.get("/current/intro-min-duration")
async def get_current_intro_min_duration():
    """The active profile's reel-length floor for the inherit-the-default intro
    resolution path (T5215). Lives on profile.sqlite (per-profile, like the
    default card itself -- epic decision 7), NOT the cross-profile registry in
    user.sqlite, so this is scoped to the CURRENT profile only (resolved via
    the request's profile context), unlike the other routes in this file."""
    from app.database import get_db_connection

    with get_db_connection() as conn:
        cursor = conn.cursor()
        value = get_intro_min_duration(cursor)
    return {"intro_min_duration_seconds": value}


@router.patch("/current/intro-min-duration")
async def update_current_intro_min_duration(request: UpdateIntroMinDurationRequest):
    """Surgical, gesture-only write of the current profile's intro-duration
    threshold. `0 < value <= 300` seconds; out-of-range is REJECTED with a
    clear 400, never clamped silently (CLAUDE.md: no silent fallback for
    internal data -- a typo here would silently misconfigure intros
    profile-wide)."""
    from app.database import column_exists, get_db_connection

    try:
        value = validate_intro_min_duration(request.intro_min_duration_seconds)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from None

    with get_db_connection() as conn:
        cursor = conn.cursor()
        if not column_exists(cursor, "user_settings", "intro_min_duration_seconds"):
            raise HTTPException(
                status_code=503,
                detail="Intro duration settings are not available yet for this "
                       "profile (pending migration).",
            )
        cursor.execute(
            "UPDATE user_settings SET intro_min_duration_seconds = ? WHERE id = 1",
            (value,),
        )
        conn.commit()
    return {"intro_min_duration_seconds": value}


@router.put("/{profile_id}")
async def update_profile(profile_id: str, request: UpdateProfileRequest):
    """Update a profile's name and/or color."""
    user_id = get_current_user_id()
    profiles = get_profiles(user_id)
    profile = next((p for p in profiles if p["id"] == profile_id), None)

    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    name = profile["name"]
    color = profile["color"]
    sport = profile["sport"]

    if request.name is not None:
        # Check for duplicate name (case-insensitive), excluding this profile
        existing_names = [
            p["name"].lower() for p in profiles
            if p["id"] != profile_id and p["name"]
        ]
        if request.name.strip().lower() in existing_names:
            raise HTTPException(status_code=409, detail="A profile with this name already exists")
        name = request.name.strip()

    if request.color is not None:
        color = request.color
    if request.sport is not None:
        sport = request.sport

    db_update_profile(user_id, profile_id, name=name, color=color, sport=sport)

    logger.info(f"Updated profile {profile_id} for user {user_id}")

    return {"id": profile_id, "name": name, "color": color, "sport": sport}


# ---------------------------------------------------------------------------
# Player-intro: image upload + parental-consent attestation (T5190)
# ---------------------------------------------------------------------------

def _intro_key_referenced_by_a_card(user_id: str, profile_id: str, key: str) -> bool:
    """True when an intro CARD in this profile still references ``key`` (T6650
    shared-ownership guard for the profile side).

    Cards seed their `image_key` from the profile's `intro_photo_key`, so
    removing or replacing the profile photo must not destroy an R2 object a card
    still points at (the mirror of the card-delete guard).

    The card table lives in the profile's `profile.sqlite`, which
    `get_db_connection` opens for the CURRENT profile context. When the request
    targets a non-current profile we cannot cheaply/safely inspect its card
    table here, so we conservatively report "referenced" — never destroy an
    object we cannot prove is unreferenced. A leaked object is the lesser evil
    (T5230's purge is the backstop) and in practice the photo add/remove gesture
    always targets the active profile.
    """
    from app.profile_context import get_current_profile_id

    if get_current_profile_id() != profile_id:
        return True
    from app.database import get_db_connection
    with get_db_connection() as conn:
        return intro_image_has_other_reference(
            conn.cursor(), user_id, profile_id, key, include_profile_key=False
        )


@router.post("/{profile_id}/intro/image")
async def upload_intro_image(profile_id: str, image: UploadFile = File(...)):
    """Upload a single still for a profile's intro card (gesture-only).

    Decode-verifies the upload is a real image (rejects anything cv2 can't
    decode -> 400, never trusting the extension or declared content type),
    re-encodes it to a ~1440px long edge preserving alpha, and stores it under
    the PER-PROFILE R2 prefix `.../profiles/{profile_id}/intro/{uuid}.{ext}`.

    Persists the returned key onto this PROFILE (user.sqlite, same mechanism as
    intro consent) so it survives a reload/new session/other device — this is
    the fix for the bug where an upload was never recorded anywhere. A card row
    (T5195) may later default its own image from this profile-level key, but
    this endpoint remains the sole owner of the R2 object. Replacing an existing
    photo deletes the previous object before persisting the new key.
    """
    user_id = get_current_user_id()
    _require_owned_profile(user_id, profile_id)

    raw = await image.read()
    try:
        stored = store_intro_image(user_id, profile_id, raw)
    except InvalidImageError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if stored is None:
        raise HTTPException(status_code=500, detail="Failed to store the intro image")

    # Replacing the photo destroys the PREVIOUS object only when no card still
    # references it (T6650 shared-ownership guard — the mirror of the card-delete
    # rule). A card seeds its image_key from this profile key, so a blind delete
    # here would blank that card's photo.
    previous_key = get_intro_photo_key(user_id, profile_id)
    if (
        previous_key
        and previous_key != stored["key"]
        and not _intro_key_referenced_by_a_card(user_id, profile_id, previous_key)
    ):
        delete_intro_image(user_id, profile_id, previous_key)

    set_intro_photo_key(user_id, profile_id, stored["key"])

    return {
        "success": True,
        "key": stored["key"],
        "previewUrl": stored["previewUrl"],
    }


@router.delete("/{profile_id}/intro/image")
async def remove_intro_image(profile_id: str, request: DeleteIntroImageRequest):
    """Remove a profile's intro image (gesture-only).

    Clears the persisted `intro_photo_key` (so a reload does not resurrect a
    preview pointing at a deleted object) and destroys the R2 object via the
    callable `delete_intro_image` service, which refuses a key that does not
    belong to this profile's intro prefix.

    SHARED-OWNERSHIP RULE (T6650): the R2 object is destroyed ONLY when no intro
    card still references it — a card seeds its `image_key` from this same
    profile key, so a blind delete would blank that card's photo. When a card
    still references it, the profile reference is cleared but the object is kept
    alive for the card (the mirror of the card-delete guard). T5230's compliance
    purge deletes intro media unconditionally via a SEPARATE whole-prefix path
    (`storage.delete_user_r2_data`) and is unaffected by this reference check.
    """
    user_id = get_current_user_id()
    _require_owned_profile(user_id, profile_id)

    if not _intro_key_referenced_by_a_card(user_id, profile_id, request.key):
        try:
            deleted = delete_intro_image(user_id, profile_id, request.key)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        if not deleted:
            raise HTTPException(status_code=500, detail="Failed to delete the intro image")

    if get_intro_photo_key(user_id, profile_id) == request.key:
        clear_intro_photo_key(user_id, profile_id)

    return {"success": True}


@router.post("/{profile_id}/intro/consent")
async def record_intro_consent(profile_id: str):
    """Record parental-consent attestation for a profile (gesture-only).

    Fired by the consent checkbox at first card creation. Gates intro use:
    without it, T5215 refuses to attach any card to a reel or collection. The
    write lands in user.sqlite (TrackedConnection -> synced to R2).
    """
    user_id = get_current_user_id()
    _require_owned_profile(user_id, profile_id)

    now = datetime.now(UTC).isoformat()
    set_intro_consent(user_id, profile_id, now)
    logger.info(f"Recorded intro consent for profile {profile_id} (user {user_id})")

    return {"introConsentAt": now}


@router.delete("/{profile_id}/intro/consent")
async def revoke_intro_consent(profile_id: str):
    """Revoke parental consent for a profile (gesture-only).

    Re-shows the checkbox and re-gates intro use. Also the path T5230's purge
    calls when erasing a minor's consent record.
    """
    user_id = get_current_user_id()
    _require_owned_profile(user_id, profile_id)

    clear_intro_consent(user_id, profile_id)
    logger.info(f"Revoked intro consent for profile {profile_id} (user {user_id})")

    return {"introConsentAt": None}


@router.put("/{profile_id}/intro/facts")
async def update_intro_fact(profile_id: str, request: UpdateIntroFactRequest):
    """Set or clear one structured intro fact (position/class/team) for a
    profile (gesture-only: ProfileIntroSection commits on blur, never per
    keystroke and never a reactive effect).

    Surgical by design -- one field per call, matching the photo/consent
    endpoints above -- so committing "team" on blur can never clobber a
    concurrently-typed "position". A blank/whitespace-only value clears the
    field rather than storing an empty string: absence is the real state a
    card composition reads (epic decision 2), not a stored placeholder.
    """
    user_id = get_current_user_id()
    _require_owned_profile(user_id, profile_id)

    trimmed = (request.value or "").strip()
    if trimmed:
        set_intro_fact(user_id, profile_id, request.field, trimmed)
    else:
        clear_intro_fact(user_id, profile_id, request.field)

    return {"field": request.field, "value": trimmed or None}


@router.delete("/{profile_id}")
async def delete_profile(profile_id: str):
    """Delete a profile and all its data.

    Cannot delete the last remaining profile. If deleting the current
    profile, auto-switches to another one first.
    """
    user_id = get_current_user_id()
    profiles = get_profiles(user_id)
    profile_ids = {p["id"] for p in profiles}

    if profile_id not in profile_ids:
        raise HTTPException(status_code=404, detail="Profile not found")

    if len(profiles) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete last profile")

    # If deleting the current profile, switch to another first
    current = get_selected_profile_id(user_id)
    if profile_id == current:
        other_id = next(p["id"] for p in profiles if p["id"] != profile_id)
        set_selected_profile_id(user_id, other_id)
        invalidate_user_cache(user_id)

    # Check if deleting the default profile — reassign default
    deleted_profile = next(p for p in profiles if p["id"] == profile_id)
    if deleted_profile["is_default"]:
        new_default = next(p["id"] for p in profiles if p["id"] != profile_id)
        set_default_profile(user_id, new_default)

    db_delete_profile(user_id, profile_id)

    # Delete R2 profile data and local data
    delete_profile_r2_data(user_id, profile_id)
    delete_local_profile_data(user_id, profile_id)

    logger.info(f"Deleted profile {profile_id} for user {user_id}")

    return {"deleted": profile_id}
