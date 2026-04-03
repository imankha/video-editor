"""
Settings Router - User preferences that persist across sessions

Settings are stored as individual key-value rows in user.sqlite (pref.* keys).
Each setting is independent — a bad write to one cannot corrupt others.
Global per-user, not per-profile.
"""

import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter
from pydantic import BaseModel

from app.services.user_db import get_all_preferences, set_preferences_bulk, clear_all_preferences
from app.constants import DEFAULT_HIGHLIGHT_EFFECT

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


# Flat defaults — keys match DB rows exactly
DEFAULTS = {
    "statusFilter": "uncompleted",
    "aspectFilter": "all",
    "creationFilter": "all",
    "includeAudio": "true",
    "defaultAspectRatio": "9:16",
    "defaultTransition": "cut",
    "highlightEffectType": DEFAULT_HIGHLIGHT_EFFECT.value,
}

# Map from nested frontend shape to flat keys
_SECTION_KEYS = {
    "projectFilters": ["statusFilter", "aspectFilter", "creationFilter"],
    "framing": ["includeAudio", "defaultAspectRatio", "defaultTransition"],
    "overlay": ["highlightEffectType"],
}


def _to_nested(flat: dict) -> dict:
    """Convert flat key-value dict to nested frontend shape."""
    result = {}
    for section, keys in _SECTION_KEYS.items():
        result[section] = {}
        for key in keys:
            value = flat.get(key, DEFAULTS.get(key))
            # Convert string booleans back to booleans for frontend
            if value == "true":
                value = True
            elif value == "false":
                value = False
            result[section][key] = value
    return result


def _flatten_updates(updates: dict) -> dict:
    """Flatten nested update dict to flat key-value pairs (strings only)."""
    flat = {}
    for section_value in updates.values():
        if isinstance(section_value, dict):
            for k, v in section_value.items():
                # Convert booleans to strings for storage
                if isinstance(v, bool):
                    flat[k] = "true" if v else "false"
                else:
                    flat[k] = str(v)
    return flat


class SettingsUpdate(BaseModel):
    """Partial settings update - only include fields to change"""
    projectFilters: Optional[Dict[str, Any]] = None
    framing: Optional[Dict[str, Any]] = None
    overlay: Optional[Dict[str, Any]] = None


@router.get("")
async def get_settings():
    """
    Get all user settings, merged with defaults.

    Returns settings with defaults filled in for any missing values.
    """
    stored = get_all_preferences()
    merged = {**DEFAULTS, **stored}
    return _to_nested(merged)


@router.put("")
async def update_settings(updates: SettingsUpdate):
    """
    Update user settings (partial update).

    Only fields included in the request are updated.
    Each setting is written as its own row — independent of others.
    """
    updates_dict = updates.model_dump(exclude_none=True)
    flat = _flatten_updates(updates_dict)

    if flat:
        set_preferences_bulk(prefs=flat)
        logger.info(f"Settings updated: {list(flat.keys())}")

    # Return full settings with defaults
    stored = get_all_preferences()
    merged = {**DEFAULTS, **stored}
    return _to_nested(merged)


@router.delete("")
async def reset_settings():
    """Reset all settings to defaults"""
    clear_all_preferences()
    logger.info("Settings reset to defaults")
    return _to_nested(DEFAULTS)
