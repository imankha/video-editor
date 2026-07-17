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
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.middleware.db_sync import DURABLE_SYNC_FAILED_RESPONSE, durable_sync
from app.profile_context import set_current_profile_id
from app.services.user_db import (
    create_profile as db_create_profile,
)
from app.services.user_db import (
    delete_profile as db_delete_profile,
)
from app.services.user_db import (
    get_profiles,
    get_selected_profile_id,
    set_default_profile,
    set_selected_profile_id,
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

    return {"profiles": [
        {
            "id": p["id"],
            "name": p["name"],
            "color": p["color"],
            "sport": p["sport"],
            "isDefault": bool(p["is_default"]),
            "isCurrent": p["id"] == selected,
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
    if not sync_db_to_r2_explicit(user_id, new_id):
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
