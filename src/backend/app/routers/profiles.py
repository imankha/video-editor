"""
Profile CRUD and switching endpoints.

Manages profiles.json and selected-profile.json in R2 for multi-athlete
support. Each profile gets its own database, clips, projects, and exports.
Games are shared across profiles (global via T80).

Endpoints:
    GET    /api/profiles          - List all profiles
    POST   /api/profiles          - Create new profile
    PUT    /api/profiles/current  - Switch active profile
    PUT    /api/profiles/{id}     - Update profile (name, color)
    DELETE /api/profiles/{id}     - Delete profile + all its data
"""

import logging
from uuid import uuid4
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.user_context import get_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import invalidate_user_cache
from app.storage import (
    read_profiles_json,
    read_selected_profile_from_r2,
    save_profiles_json,
    upload_selected_profile_json,
    delete_profile_r2_data,
    delete_local_profile_data,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


# ---------------------------------------------------------------------------
# Request/Response Models
# ---------------------------------------------------------------------------

class CreateProfileRequest(BaseModel):
    name: str
    color: str


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class SwitchProfileRequest(BaseModel):
    profileId: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_profiles():
    """List all profiles for the current user.

    Returns profiles with metadata including which is current and default.
    """
    user_id = get_current_user_id()
    data = read_profiles_json(user_id)

    if not data:
        return {"profiles": []}

    selected = read_selected_profile_from_r2(user_id)

    profiles = []
    for profile_id, meta in data.get("profiles", {}).items():
        profiles.append({
            "id": profile_id,
            "name": meta.get("name"),
            "color": meta.get("color"),
            "isDefault": profile_id == data.get("default"),
            "isCurrent": profile_id == selected,
        })

    return {"profiles": profiles}


@router.post("")
async def create_profile(request: CreateProfileRequest):
    """Create a new profile.

    Generates a new GUID, adds to profiles.json, initializes a fresh
    database, and auto-switches to the new profile.
    """
    user_id = get_current_user_id()
    data = read_profiles_json(user_id)

    if not data:
        raise HTTPException(status_code=500, detail="Could not read profiles.json")

    # Check for duplicate name (case-insensitive)
    existing_names = [
        meta.get("name", "").lower()
        for meta in data["profiles"].values()
        if meta.get("name")
    ]
    if request.name.strip().lower() in existing_names:
        raise HTTPException(status_code=409, detail="A profile with this name already exists")

    new_id = uuid4().hex[:8]
    data["profiles"][new_id] = {
        "name": request.name.strip(),
        "color": request.color,
    }

    save_profiles_json(user_id, data)

    # Initialize DB for new profile
    set_current_profile_id(new_id)
    from app.database import ensure_database
    ensure_database()

    # Auto-switch to new profile
    upload_selected_profile_json(user_id, new_id)
    invalidate_user_cache(user_id)

    logger.info(f"Created profile {new_id} ({request.name}) for user {user_id}")

    return {"id": new_id, "name": request.name, "color": request.color}


@router.put("/current")
async def switch_profile(request: SwitchProfileRequest):
    """Switch the active profile.

    Updates selected-profile.json in R2 and invalidates the session
    init cache so the next request uses the new profile.
    """
    user_id = get_current_user_id()
    data = read_profiles_json(user_id)

    if not data or request.profileId not in data.get("profiles", {}):
        raise HTTPException(status_code=404, detail="Profile not found")

    upload_selected_profile_json(user_id, request.profileId)
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
    data = read_profiles_json(user_id)

    if not data or profile_id not in data.get("profiles", {}):
        raise HTTPException(status_code=404, detail="Profile not found")

    profile = data["profiles"][profile_id]
    if request.name is not None:
        # Check for duplicate name (case-insensitive), excluding this profile
        existing_names = [
            meta.get("name", "").lower()
            for pid, meta in data["profiles"].items()
            if pid != profile_id and meta.get("name")
        ]
        if request.name.strip().lower() in existing_names:
            raise HTTPException(status_code=409, detail="A profile with this name already exists")
        profile["name"] = request.name.strip()
    if request.color is not None:
        profile["color"] = request.color

    save_profiles_json(user_id, data)

    logger.info(f"Updated profile {profile_id} for user {user_id}")

    return {"id": profile_id, "name": profile["name"], "color": profile.get("color")}


@router.delete("/{profile_id}")
async def delete_profile(profile_id: str):
    """Delete a profile and all its data.

    Cannot delete the last remaining profile. If deleting the current
    profile, auto-switches to another one first.
    """
    user_id = get_current_user_id()
    data = read_profiles_json(user_id)

    if not data or profile_id not in data.get("profiles", {}):
        raise HTTPException(status_code=404, detail="Profile not found")

    if len(data["profiles"]) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete last profile")

    # If deleting the current profile, switch to another first
    current = read_selected_profile_from_r2(user_id)
    if profile_id == current:
        other_id = next(pid for pid in data["profiles"] if pid != profile_id)
        upload_selected_profile_json(user_id, other_id)
        invalidate_user_cache(user_id)

    # Remove from profiles.json
    del data["profiles"][profile_id]
    if data.get("default") == profile_id:
        data["default"] = next(iter(data["profiles"]))

    save_profiles_json(user_id, data)

    # Delete R2 data and local data
    delete_profile_r2_data(user_id, profile_id)
    delete_local_profile_data(user_id, profile_id)

    logger.info(f"Deleted profile {profile_id} for user {user_id}")

    return {"deleted": profile_id}
