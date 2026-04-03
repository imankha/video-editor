"""
Settings Router - User preferences that persist across sessions

Settings are stored as JSON in the user.sqlite key-value table (key='preferences').
This makes settings global per-user, not per-profile.

Settings are synced to R2 like all other user data.
"""

import json
import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.user_db import get_preferences, set_preferences
from app.constants import DEFAULT_HIGHLIGHT_EFFECT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


# Default settings values
DEFAULT_SETTINGS = {
    # Project filters (ProjectManager)
    "projectFilters": {
        "statusFilter": "uncompleted",
        "aspectFilter": "all",
        "creationFilter": "all",
    },
    # Framing preferences
    "framing": {
        "includeAudio": True,
        "defaultAspectRatio": "9:16",
        "defaultTransition": "cut",
    },
    # Overlay preferences
    "overlay": {
        "highlightEffectType": DEFAULT_HIGHLIGHT_EFFECT.value,
    },
}


class SettingsUpdate(BaseModel):
    """Partial settings update - only include fields to change"""
    projectFilters: Optional[Dict[str, Any]] = None
    framing: Optional[Dict[str, Any]] = None
    overlay: Optional[Dict[str, Any]] = None


def deep_merge(base: dict, updates: dict) -> dict:
    """Recursively merge updates into base dict"""
    result = base.copy()
    for key, value in updates.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


@router.get("")
async def get_settings():
    """
    Get all user settings, merged with defaults.

    Returns settings with defaults filled in for any missing values.
    """
    raw = get_preferences(user_id=None)

    if raw:
        try:
            stored = json.loads(raw)
        except json.JSONDecodeError:
            stored = {}
    else:
        stored = {}

    # Merge stored settings with defaults (stored takes precedence)
    merged = deep_merge(DEFAULT_SETTINGS, stored)

    return merged


@router.put("")
async def update_settings(updates: SettingsUpdate):
    """
    Update user settings (partial update).

    Only fields included in the request are updated.
    Nested objects are merged, not replaced.
    """
    raw = get_preferences(user_id=None)

    if raw:
        try:
            current = json.loads(raw)
        except json.JSONDecodeError:
            current = {}
    else:
        current = {}

    # Merge updates (only non-None fields)
    updates_dict = updates.model_dump(exclude_none=True)
    merged = deep_merge(current, updates_dict)

    # Save to user.sqlite
    set_preferences(user_id=None, preferences_json=json.dumps(merged))

    logger.info(f"Settings updated: {list(updates_dict.keys())}")

    # Return merged with defaults
    return deep_merge(DEFAULT_SETTINGS, merged)


@router.delete("")
async def reset_settings():
    """Reset all settings to defaults"""
    set_preferences(user_id=None, preferences_json="{}")

    logger.info("Settings reset to defaults")
    return DEFAULT_SETTINGS
