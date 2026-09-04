"""
Shared constants for the Video Editor API.

This module is the single source of truth for rating-related constants
used across the application. All rating notation, colors, and adjectives
should be imported from here to avoid duplication and inconsistencies.
"""

from enum import Enum

# =============================================================================
# Export Status Constants
# =============================================================================

class ExportStatus(str, Enum):
    """Export job status values for WebSocket messages and database."""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETE = "complete"
    ERROR = "error"


class ExportStage(str, Enum):
    """Durable finalize checkpoints on export_jobs.stage (T5630).

    Ordered pipeline a Modal export walks; each transition is a small durable
    UPDATE, so a restart at any point leaves `stage` at the last COMPLETED step
    and recovery re-runs ONLY the missing stages. Six states (the design dropped
    the task's 7th `synced` checkpoint — sync is a gate between `persisting` and
    `complete`, never a persisted state we branch on):

        queued -> rendering -> rendered -> detecting -> persisting -> complete   (| error)

    - rendering:  dispatched, modal_call_id stored (render maybe in flight).
    - rendered:   the video exists in R2; output_key persisted -> finalize no
                  longer depends on Modal being reachable.
    - detecting / persisting / complete: the post-render stages the unified
                  finalizer owns. `error` is tracked by `status`, not `stage`.
    """
    QUEUED = "queued"
    RENDERING = "rendering"
    RENDERED = "rendered"
    DETECTING = "detecting"
    PERSISTING = "persisting"
    COMPLETE = "complete"


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
RATING_ADJECTIVES: dict[int, str] = {
    5: 'Brilliant',
    4: 'Good',
    3: 'Interesting',
    2: 'Technical Lapse',
    1: 'Mental Lapse'
}

# Rating notation symbols (chess-inspired, for display overlays)
# Used in video overlays and exports
RATING_NOTATION: dict[int, str] = {
    1: '??',   # Blunder
    2: '?',    # Mistake
    3: '!?',   # Interesting
    4: '!',    # Good
    5: '!!'    # Brilliant
}

# Rating colors (color-blind safe palette) for FFmpeg overlays
# Format: 0xRRGGBB for FFmpeg compatibility
RATING_COLORS_HEX: dict[int, str] = {
    1: '0xC62828',  # Brick Red - Blunder
    2: '0xF9A825',  # Amber Yellow - Mistake
    3: '0x1565C0',  # Strong Blue - Interesting
    4: '0x2E7D32',  # Teal-Green - Good
    5: '0x66BB6A',  # Light Green - Brilliant
}

# Rating colors as CSS hex (without 0x prefix) for frontend consistency
RATING_COLORS_CSS: dict[int, str] = {
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



# Tag definitions live in the frontend (soccerTags.js) as the single source of truth.
# The backend stores tags as opaque strings - no validation or mapping needed here.


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
# Export Source Types
# =============================================================================

class SourceType(str, Enum):
    """
    Source type for final video exports.

    Indicates where the export originated from:
    - BRILLIANT_CLIP: Auto-generated from a brilliant-rated clip
    - CUSTOM_PROJECT: User-created project with custom clip selection
    - ANNOTATED_GAME: Full game export from annotate mode
    """
    BRILLIANT_CLIP = "brilliant_clip"
    CUSTOM_PROJECT = "custom_project"
    ANNOTATED_GAME = "annotated_game"

    @property
    def display_label(self) -> str:
        """Human-readable label for UI display."""
        labels = {
            SourceType.BRILLIANT_CLIP: "Brilliant Clip",
            SourceType.CUSTOM_PROJECT: "Custom Project",
            SourceType.ANNOTATED_GAME: "Annotated Game",
        }
        return labels.get(self, "Video")


# =============================================================================
# Game Constants
# =============================================================================

class GameType(str, Enum):
    """Game type indicating venue/context."""
    HOME = "home"
    AWAY = "away"
    TOURNAMENT = "tournament"


class VideoMode(str, Enum):
    """How video files are organized for a game."""
    PER_GAME = "per_game"
    PER_HALF = "per_half"


class UploadStatus(str, Enum):
    """Status returned from prepare-upload / finalize-upload (R2 layer)."""
    EXISTS = "exists"
    UPLOAD_REQUIRED = "upload_required"
    SUCCESS = "success"


class UploadKind(str, Enum):
    """T8370: what a prepare-upload/finalize-upload session is FOR, routing the
    object namespace (games_upload.upload_object_key) and the finalize-time
    success milestone (game_upload_succeeded is emitted ONLY for GAME). Stored
    on pending_uploads.kind so finalize/reap/cancel can route without trusting
    client-declared intent at finalize time."""
    GAME = "game"
    CLIP = "clip"


# T8370 §4.3: clip sources are permanent (never expire, INV-U1/INV-U2), so an
# unbounded upload at a ~1-credit charge is exploitable. Over either cap the
# user is steered to Add Game (400), never silently truncated. Lives here
# (not in games_upload.py) so clips.py's batch endpoint doesn't need a
# cross-router import for a shared cap.
MAX_CLIP_UPLOAD_BYTES = 500 * 1024 * 1024  # 500MB
MAX_CLIP_DURATION_S = 600  # 10 minutes — enforced at probe time (clips.py batch endpoint)


class GameStatus(str, Enum):
    """Lifecycle status for a game record.

    pending       — created before video upload completes. Provides game_id as FK
                    anchor for clip persistence. Not visible to downstream consumers.
    ready         — video confirmed in R2. Downstream consumers only see ready games.
    upload_failed — the upload never finished and its R2 multipart session is gone
                    (T7490). Set by the honest reap in list_pending_uploads when a
                    stale resume record is found alongside a still-pending game, so
                    the game becomes a VISIBLE, user-actionable card (Retry / Discard)
                    instead of an invisible orphan. Distinct from 'pending' so the
                    Games tab can render it (readyGames = status != 'pending').
    """
    PENDING = "pending"
    READY = "ready"
    UPLOAD_FAILED = "upload_failed"


class GameCreateStatus(str, Enum):
    """Status returned from POST /api/games (game management layer)."""
    ALREADY_OWNED = "already_owned"
    CREATED = "created"


class RecapLayer(str, Enum):
    """Per-layer recap split (T5710). Mirrors raw_clips.my_athlete:
    ATHLETE = (my_athlete = 1 OR my_athlete IS NULL) -- NULL is pre-migration legacy.
    TEAM = my_athlete = 0 (includes imported clips, shared_by NOT NULL)."""
    ATHLETE = "athlete"
    TEAM = "team"


class ShareClipScope(str, Enum):
    """T5740: per-recipient clip scope on the game share (Google-Docs-style).
    Picks WHICH clips a recipient receives; My-Athlete clips (my_athlete != 0)
    NEVER cross under any scope (EPIC decision 1/3).

    ALL_TEAM     -> every Team-layer clip (my_athlete = 0) for the game.
    TAGGED_ONLY  -> only Team clips the recipient's email is tagged in
                    (teammate_emails -> tag_name -> clip_teammates). Zero clips
                    when the email has no tag mapping -- surfaced before send.
    GAME_ONLY    -> the game/team recap and zero clips (preserves the pre-T5740
                    game-only share behavior as an explicit, selectable choice)."""
    ALL_TEAM = "all_team"
    TAGGED_ONLY = "tagged_only"
    GAME_ONLY = "game_only"


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
# All users get a UUID via /api/auth/init-guest. No default user ID —
# missing user context is a hard error (see user_context.py).
