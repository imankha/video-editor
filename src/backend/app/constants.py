"""
Shared constants for the Video Editor API.

This module is the single source of truth for rating-related constants
used across the application. All rating notation, colors, and adjectives
should be imported from here to avoid duplication and inconsistencies.
"""

from typing import Dict

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
