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
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.middleware.db_sync import DURABLE_SYNC_FAILED_RESPONSE, durable_sync
from app.profile_context import set_current_profile_id
from app.services.intro_media import (
    InvalidImageError,
    delete_intro_image,
    store_intro_image,
)
from app.services.user_db import (
    clear_intro_consent,
    get_all_intro_consents,
    get_profiles,
    get_selected_profile_id,
    set_default_profile,
    set_intro_consent,
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

    return {"profiles": [
        {
            "id": p["id"],
            "name": p["name"],
            "color": p["color"],
            "sport": p["sport"],
            "isDefault": bool(p["is_default"]),
            "isCurrent": p["id"] == selected,
            "introConsentAt": consents.get(p["id"]),
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

@router.post("/{profile_id}/intro/image")
async def upload_intro_image(profile_id: str, image: UploadFile = File(...)):
    """Upload a single still for a profile's intro card (gesture-only).

    Decode-verifies the upload is a real image (rejects anything cv2 can't
    decode -> 400, never trusting the extension or declared content type),
    re-encodes it to a ~1440px long edge preserving alpha, and stores it under
    the PER-PROFILE R2 prefix `.../profiles/{profile_id}/intro/{uuid}.{ext}`.

    Owns the R2 OBJECT only: the returned key is written onto an intro_cards row
    by T5195, so this endpoint never touches a DB row. Returns the full
    per-profile key (includes the profile id — the cross-profile 404 guard) plus
    a presigned preview URL.
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

    return {
        "success": True,
        "key": stored["key"],
        "previewUrl": stored["previewUrl"],
    }


@router.delete("/{profile_id}/intro/image")
async def remove_intro_image(profile_id: str, request: DeleteIntroImageRequest):
    """Remove a profile's intro image R2 object (gesture-only).

    Delegates to the callable `delete_intro_image` service (the same function
    T5230's compliance purge calls), which refuses a key that does not belong to
    this profile's intro prefix.
    """
    user_id = get_current_user_id()
    _require_owned_profile(user_id, profile_id)

    try:
        deleted = delete_intro_image(user_id, profile_id, request.key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete the intro image")

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
