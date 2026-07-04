"""
Settings Router - User preferences that persist across sessions

Settings are stored as individual key-value rows in user.sqlite (pref.* keys).
Each setting is independent — a bad write to one cannot corrupt others.
Global per-user, not per-profile.
"""

import logging
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from app.constants import DEFAULT_HIGHLIGHT_EFFECT
from app.services.user_db import clear_all_preferences, get_all_preferences, set_preferences_bulk

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


# Flat defaults — keys match DB rows exactly.
# projectFilters (statusFilter/aspectFilter/creationFilter) were REMOVED
# 2026-07-04: filters are session-only view state now. A persisted filter once
# hid every draft behind an invisible control ("Showing 0 of 18"). Old pref.*
# filter rows may still exist in user DBs; they are simply never read.
DEFAULTS = {
    "includeAudio": "true",
    "defaultAspectRatio": "9:16",
    "defaultTransition": "cut",
    "highlightEffectType": DEFAULT_HIGHLIGHT_EFFECT.value,
    "rankSoundEnabled": "true",  # T3630: ranking-game pick sound on by default (mute pref)
}

# Map from nested frontend shape to flat keys
_SECTION_KEYS = {
    "framing": ["includeAudio", "defaultAspectRatio", "defaultTransition"],
    "overlay": ["highlightEffectType"],
    "ranking": ["rankSoundEnabled"],
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
    """Flatten nested update dict to flat key-value pairs (strings only).

    Only sections in _SECTION_KEYS are accepted — so legacy clients that still
    PUT projectFilters can't re-create persisted filter rows.
    """
    flat = {}
    for section, section_value in updates.items():
        if section not in _SECTION_KEYS:
            continue
        if isinstance(section_value, dict):
            for k, v in section_value.items():
                # Convert booleans to strings for storage
                if isinstance(v, bool):
                    flat[k] = "true" if v else "false"
                else:
                    flat[k] = str(v)
    return flat


class SettingsUpdate(BaseModel):
    """Partial settings update - only include fields to change.

    projectFilters is still ACCEPTED (legacy clients send it) but ignored by
    _flatten_updates — filters are session-only view state, never persisted.
    """
    projectFilters: dict[str, Any] | None = None
    framing: dict[str, Any] | None = None
    overlay: dict[str, Any] | None = None
    ranking: dict[str, Any] | None = None


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
