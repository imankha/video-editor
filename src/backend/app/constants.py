"""
Shared constants for the Video Editor API.

This module is the single source of truth for rating-related constants
used across the application. All rating notation, colors, and adjectives
should be imported from here to avoid duplication and inconsistencies.
"""

from enum import Enum
from typing import Dict


# =============================================================================
# Export Status Constants
# =============================================================================

class ExportStatus(str, Enum):
    """Export job status values for WebSocket messages and database."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETE = "complete"
    ERROR = "error"


class ExportPhase(str, Enum):
    """
    Progress phases within an export job.

    This is the SINGLE SOURCE OF TRUTH for export progress state.
    Status is derived from phase - never set independently:
    - COMPLETE → ExportStatus.COMPLETE
    - ERROR → ExportStatus.ERROR
    - All others → ExportStatus.PROCESSING

    Usage:
        phase = ExportPhase.PROCESSING
        status = phase.to_status()  # Returns ExportStatus.PROCESSING
    """
    INIT = "init"
    DOWNLOAD = "download"
    PROCESSING = "processing"
    UPLOAD = "upload"
    FINALIZING = "finalizing"
    COMPLETE = "complete"
    ERROR = "error"

    def to_status(self) -> ExportStatus:
        """Derive ExportStatus from this phase. Single source of truth."""
        if self == ExportPhase.COMPLETE:
            return ExportStatus.COMPLETE
        elif self == ExportPhase.ERROR:
            return ExportStatus.ERROR
        else:
            return ExportStatus.PROCESSING

    @property
    def is_done(self) -> bool:
        """Whether this phase indicates completion (success or error)."""
        return self in (ExportPhase.COMPLETE, ExportPhase.ERROR)


def phase_to_status(phase: str) -> ExportStatus:
    """
    Derive ExportStatus from a phase string. Single source of truth.

    Accepts string for backwards compatibility with existing code.
    """
    if phase == ExportPhase.COMPLETE or phase == "done":
        return ExportStatus.COMPLETE
    elif phase == ExportPhase.ERROR:
        return ExportStatus.ERROR
    else:
        return ExportStatus.PROCESSING

# Rating adjectives for clip name generation (1-5 stars)
# Used to generate names like "Brilliant Goal and Dribble"
RATING_ADJECTIVES: Dict[int, str] = {
    5: 'Brilliant',
    4: 'Good',
    3: 'Interesting',
    2: 'Unfortunate',
    1: 'Bad'
}

# Rating notation symbols (chess-inspired, for display overlays)
# Used in video overlays and exports
RATING_NOTATION: Dict[int, str] = {
    1: '??',   # Blunder
    2: '?',    # Mistake
    3: '!?',   # Interesting
    4: '!',    # Good
    5: '!!'    # Brilliant
}

# Rating colors (color-blind safe palette) for FFmpeg overlays
# Format: 0xRRGGBB for FFmpeg compatibility
RATING_COLORS_HEX: Dict[int, str] = {
    1: '0xC62828',  # Brick Red - Blunder
    2: '0xF9A825',  # Amber Yellow - Mistake
    3: '0x1565C0',  # Strong Blue - Interesting
    4: '0x2E7D32',  # Teal-Green - Good
    5: '0x66BB6A',  # Light Green - Brilliant
}

# Rating colors as CSS hex (without 0x prefix) for frontend consistency
RATING_COLORS_CSS: Dict[int, str] = {
    1: '#C62828',  # Brick Red - Blunder
    2: '#F9A825',  # Amber Yellow - Mistake
    3: '#1565C0',  # Strong Blue - Interesting
    4: '#2E7D32',  # Teal-Green - Good
    5: '#66BB6A',  # Light Green - Brilliant
}

# Version for overlay style - increment to invalidate cache when style changes
OVERLAY_STYLE_VERSION: int = 2

# Valid rating range
MIN_RATING: int = 1
MAX_RATING: int = 5

# Default rating for fallbacks
DEFAULT_RATING: int = 3


def get_rating_adjective(rating: int) -> str:
    """Get adjective for a rating, defaulting to 'Interesting' for invalid ratings."""
    return RATING_ADJECTIVES.get(rating, RATING_ADJECTIVES[DEFAULT_RATING])


def get_rating_notation(rating: int) -> str:
    """Get notation symbol for a rating, defaulting to '!?' for invalid ratings."""
    return RATING_NOTATION.get(rating, RATING_NOTATION[DEFAULT_RATING])


def get_rating_color_hex(rating: int) -> str:
    """Get hex color (0xRRGGBB format) for a rating, defaulting to blue for invalid ratings."""
    return RATING_COLORS_HEX.get(rating, RATING_COLORS_HEX[DEFAULT_RATING])


def get_rating_color_css(rating: int) -> str:
    """Get CSS hex color (#RRGGBB format) for a rating, defaulting to blue for invalid ratings."""
    return RATING_COLORS_CSS.get(rating, RATING_COLORS_CSS[DEFAULT_RATING])


def is_valid_rating(rating: int) -> bool:
    """Check if a rating is within valid range (1-5)."""
    return MIN_RATING <= rating <= MAX_RATING


# Tag name to short name mapping (matches frontend soccerTags.js)
# Used for generating clip names from full tag names
TAG_SHORT_NAMES: Dict[str, str] = {
    'Goals': 'Goal',
    'Assists': 'Assist',
    'Dribbling': 'Dribble',
    'Movement Off Ball': 'Movement',
    'Passing Range': 'Pass',
    'Chance Creation': 'Chance Creation',
    'Possession Play': 'Possession',
    'Transitions': 'Transition',
    'Tackles': 'Tackle',
    'Interceptions': 'Interception',
    '1v1 Defense': '1v1 Defense',
    'Build-Up Passing': 'Build-Up',
    'Shot Stopping': 'Save',
    'Command of Area': 'Command',
    'Distribution': 'Distribution',
    '1v1 Saves': '1v1 Save',
}


def get_tag_short_name(tag: str) -> str:
    """Get the short name for a tag, returning the tag itself if no mapping exists."""
    return TAG_SHORT_NAMES.get(tag, tag)


# =============================================================================
# Highlight Effect Constants
# =============================================================================

class HighlightEffect(str, Enum):
    """
    Visual effect types for player highlight overlays.

    BRIGHTNESS_BOOST: Increases brightness inside the highlight ellipse
    DARK_OVERLAY: Darkens the area outside the highlight ellipse (spotlight effect)

    Note: 'original' was removed from UI but may exist in legacy DB data.
    Use normalize_effect_type() to convert legacy values.
    """
    BRIGHTNESS_BOOST = "brightness_boost"
    DARK_OVERLAY = "dark_overlay"


# Default effect type for new overlays
DEFAULT_HIGHLIGHT_EFFECT = HighlightEffect.DARK_OVERLAY


def normalize_effect_type(effect_type: str | None) -> str:
    """
    Normalize effect type for backwards compatibility.

    Converts legacy 'original' to 'dark_overlay' since 'original' was removed.
    Returns the default if the value is None or invalid.
    """
    if effect_type is None or effect_type == 'original':
        return DEFAULT_HIGHLIGHT_EFFECT.value
    if effect_type in (HighlightEffect.BRIGHTNESS_BOOST.value, HighlightEffect.DARK_OVERLAY.value):
        return effect_type
    return DEFAULT_HIGHLIGHT_EFFECT.value


# =============================================================================
# Video Processing Constants
# =============================================================================

# Maximum output resolution (1440p cap)
# Prevents over-upscaling small crops and keeps file sizes reasonable
VIDEO_MAX_WIDTH: int = 2560
VIDEO_MAX_HEIGHT: int = 1440

# AI upscaling factor (Real-ESRGAN uses 4x by default)
AI_UPSCALE_FACTOR: int = 4


# =============================================================================
# User/Database Constants
# =============================================================================

# Default user ID for single-user mode
# This application is designed for single-user desktop use.
# The user ID creates a namespace for user_data storage.
# Future multi-user support would require authentication and dynamic user IDs.
DEFAULT_USER_ID: str = "a"
