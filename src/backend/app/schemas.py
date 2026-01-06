"""
Pydantic models for JSON data structures.

This module provides typed schemas for all JSON columns in the database,
making the data structures self-documenting and providing validation.

USAGE:
    from app.schemas import CropData, TimingData, SegmentsData, HighlightsData

    # Parse JSON from database
    crop_data = CropData.model_validate_json(json_string)

    # Serialize to JSON for storage
    json_string = crop_data.model_dump_json()

    # Access with full type hints
    for kf in crop_data.keyframes:
        print(kf.x, kf.y, kf.width, kf.height)
"""

from typing import Dict, List, Literal, Optional, Tuple, Union
from pydantic import BaseModel, Field, field_validator


# =============================================================================
# CROP DATA SCHEMA
# Used in: working_clips.crop_data
# =============================================================================

class CropKeyframe(BaseModel):
    """
    A single keyframe for crop animation.

    Keyframes define crop rectangle position/size at specific frames.
    Values between keyframes are interpolated using Catmull-Rom splines.
    """
    frame: int = Field(..., description="Frame number (0-based)")
    x: float = Field(..., description="Left edge of crop rectangle in pixels")
    y: float = Field(..., description="Top edge of crop rectangle in pixels")
    width: float = Field(..., description="Width of crop rectangle in pixels")
    height: float = Field(..., description="Height of crop rectangle in pixels")
    origin: Literal['permanent', 'user', 'trim'] = Field(
        default='user',
        description="How this keyframe was created: "
                    "'permanent' = auto-created at video start/end, "
                    "'user' = manually added by user, "
                    "'trim' = auto-created when trimming segments"
    )


class CropData(BaseModel):
    """
    Crop keyframes for a working clip.

    Stored as JSON array in working_clips.crop_data.
    Frontend generates this via useCrop hook.
    """
    keyframes: List[CropKeyframe] = Field(
        default_factory=list,
        description="Array of crop keyframes sorted by frame"
    )

    @classmethod
    def from_json_list(cls, json_list: List[dict]) -> 'CropData':
        """Create CropData from a raw JSON list (the format stored in DB)."""
        return cls(keyframes=[CropKeyframe(**kf) for kf in json_list])

    def to_json_list(self) -> List[dict]:
        """Convert to raw JSON list format for DB storage."""
        return [kf.model_dump() for kf in self.keyframes]


# =============================================================================
# TIMING DATA SCHEMA
# Used in: working_clips.timing_data
# =============================================================================

class TimingData(BaseModel):
    """
    Timing/trim settings for a working clip.

    Stored as JSON object in working_clips.timing_data.
    """
    trimRange: Optional[Tuple[float, float]] = Field(
        default=None,
        description="[start_time, end_time] in seconds, or null for no trim"
    )

    @field_validator('trimRange', mode='before')
    @classmethod
    def convert_trim_range(cls, v):
        """Convert list to tuple if needed."""
        if v is None:
            return None
        if isinstance(v, (list, tuple)) and len(v) == 2:
            return (float(v[0]), float(v[1]))
        return v


# =============================================================================
# SEGMENTS DATA SCHEMA
# Used in: working_clips.segments_data
# =============================================================================

class SegmentsData(BaseModel):
    """
    Segment boundaries and speed settings for a working clip.

    Segments divide a clip into regions that can have different playback speeds.
    Stored as JSON object in working_clips.segments_data.
    """
    boundaries: List[float] = Field(
        default_factory=lambda: [0.0],
        description="Sorted list of segment boundary times in seconds. "
                    "First element is always 0, last is video duration."
    )
    userSplits: List[float] = Field(
        default_factory=list,
        description="User-created split points (subset of boundaries)"
    )
    trimRange: Optional[Tuple[float, float]] = Field(
        default=None,
        description="Active trim range [start, end] in seconds"
    )
    segmentSpeeds: Dict[str, float] = Field(
        default_factory=dict,
        description="Speed multiplier per segment. Keys are segment indices as strings. "
                    "Missing keys default to 1.0x speed."
    )

    @field_validator('trimRange', mode='before')
    @classmethod
    def convert_trim_range(cls, v):
        """Convert list to tuple if needed."""
        if v is None:
            return None
        if isinstance(v, (list, tuple)) and len(v) == 2:
            return (float(v[0]), float(v[1]))
        return v

    def get_segment_speed(self, segment_index: int) -> float:
        """Get speed for a segment, defaulting to 1.0 if not set."""
        return self.segmentSpeeds.get(str(segment_index), 1.0)


# =============================================================================
# HIGHLIGHTS DATA SCHEMA
# Used in: working_videos.highlights_data
# =============================================================================

class HighlightKeyframe(BaseModel):
    """
    A keyframe for highlight ellipse animation.

    Defines the highlight ellipse position, size, and appearance at a point in time.
    Values between keyframes are interpolated using Catmull-Rom splines.
    """
    # Position can be specified by time (export format) or frame (internal format)
    time: Optional[float] = Field(
        default=None,
        description="Time in seconds (used in export/storage format)"
    )
    frame: Optional[int] = Field(
        default=None,
        description="Frame number (used in internal format, converted to time for export)"
    )

    # Ellipse geometry
    x: float = Field(..., description="Center X position in pixels")
    y: float = Field(..., description="Center Y position in pixels")
    radiusX: float = Field(..., description="Horizontal radius in pixels")
    radiusY: float = Field(..., description="Vertical radius in pixels")

    # Appearance
    opacity: float = Field(
        default=0.15,
        ge=0.0,
        le=1.0,
        description="Opacity of the highlight effect (0.0-1.0)"
    )
    color: str = Field(
        default='#FFFF00',
        description="Highlight color as hex string (e.g., '#FFFF00' for yellow)"
    )

    # Origin tracking
    origin: Literal['permanent', 'user'] = Field(
        default='permanent',
        description="'permanent' = auto-created at region start/end, "
                    "'user' = manually added by user"
    )


class HighlightRegion(BaseModel):
    """
    A highlight region with its keyframes.

    Regions define time ranges where highlight effects are active.
    Each region has at least 2 keyframes (start and end).
    """
    id: str = Field(..., description="Unique region identifier")

    # Time range (stored format uses snake_case)
    start_time: Optional[float] = Field(
        default=None,
        description="Region start time in seconds (snake_case for storage)"
    )
    end_time: Optional[float] = Field(
        default=None,
        description="Region end time in seconds (snake_case for storage)"
    )

    # Alternative camelCase format (for internal/frontend format)
    startTime: Optional[float] = Field(
        default=None,
        description="Region start time in seconds (camelCase for frontend)"
    )
    endTime: Optional[float] = Field(
        default=None,
        description="Region end time in seconds (camelCase for frontend)"
    )

    enabled: bool = Field(
        default=True,
        description="Whether this region's highlight effect is active"
    )

    keyframes: List[HighlightKeyframe] = Field(
        default_factory=list,
        description="Keyframes within this region, sorted by time/frame"
    )

    def get_start_time(self) -> float:
        """Get start time, handling both snake_case and camelCase formats."""
        return self.start_time if self.start_time is not None else (self.startTime or 0.0)

    def get_end_time(self) -> float:
        """Get end time, handling both snake_case and camelCase formats."""
        return self.end_time if self.end_time is not None else (self.endTime or 0.0)


class HighlightsData(BaseModel):
    """
    Highlight regions for overlay mode.

    Stored as JSON array in working_videos.highlights_data.
    Frontend generates this via useHighlightRegions hook.
    """
    regions: List[HighlightRegion] = Field(
        default_factory=list,
        description="Array of highlight regions"
    )

    @classmethod
    def from_json_list(cls, json_list: List[dict]) -> 'HighlightsData':
        """Create HighlightsData from a raw JSON list (the format stored in DB)."""
        return cls(regions=[HighlightRegion(**r) for r in json_list])

    def to_json_list(self) -> List[dict]:
        """Convert to raw JSON list format for DB storage."""
        return [r.model_dump(exclude_none=True) for r in self.regions]

    def get_enabled_regions(self) -> List[HighlightRegion]:
        """Get only enabled regions."""
        return [r for r in self.regions if r.enabled]


# =============================================================================
# TEXT OVERLAYS SCHEMA (placeholder for future use)
# Used in: working_videos.text_overlays
# =============================================================================

class TextOverlay(BaseModel):
    """
    A text overlay configuration.

    Currently a placeholder - text overlays are not fully implemented.
    """
    text: str = Field(..., description="Text content to display")
    x: float = Field(..., description="X position in pixels")
    y: float = Field(..., description="Y position in pixels")
    fontSize: int = Field(default=24, description="Font size in pixels")
    color: str = Field(default='#FFFFFF', description="Text color as hex")
    startTime: float = Field(..., description="When to show the text (seconds)")
    endTime: float = Field(..., description="When to hide the text (seconds)")


class TextOverlaysData(BaseModel):
    """
    Text overlay configuration for overlay mode.

    Stored as JSON array in working_videos.text_overlays.
    """
    overlays: List[TextOverlay] = Field(
        default_factory=list,
        description="Array of text overlay configurations"
    )

    @classmethod
    def from_json_list(cls, json_list: List[dict]) -> 'TextOverlaysData':
        """Create TextOverlaysData from a raw JSON list."""
        return cls(overlays=[TextOverlay(**t) for t in json_list])

    def to_json_list(self) -> List[dict]:
        """Convert to raw JSON list format for DB storage."""
        return [o.model_dump() for o in self.overlays]


# =============================================================================
# EFFECT TYPE ENUM
# Used in: working_videos.effect_type
# =============================================================================

EffectType = Literal['original', 'brightness_boost', 'dark_overlay']


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def parse_crop_data(json_str: Optional[str]) -> Optional[CropData]:
    """
    Safely parse crop_data JSON string.

    Args:
        json_str: JSON string from database, or None

    Returns:
        CropData object, or None if input is None/empty/invalid
    """
    if not json_str:
        return None
    try:
        import json
        data = json.loads(json_str)
        if isinstance(data, list):
            return CropData.from_json_list(data)
        return None
    except (json.JSONDecodeError, ValueError):
        return None


def parse_timing_data(json_str: Optional[str]) -> Optional[TimingData]:
    """Safely parse timing_data JSON string."""
    if not json_str:
        return None
    try:
        import json
        data = json.loads(json_str)
        if isinstance(data, dict):
            return TimingData(**data)
        return None
    except (json.JSONDecodeError, ValueError):
        return None


def parse_segments_data(json_str: Optional[str]) -> Optional[SegmentsData]:
    """Safely parse segments_data JSON string."""
    if not json_str:
        return None
    try:
        import json
        data = json.loads(json_str)
        if isinstance(data, dict):
            return SegmentsData(**data)
        return None
    except (json.JSONDecodeError, ValueError):
        return None


def parse_highlights_data(json_str: Optional[str]) -> Optional[HighlightsData]:
    """Safely parse highlights_data JSON string."""
    if not json_str:
        return None
    try:
        import json
        data = json.loads(json_str)
        if isinstance(data, list):
            return HighlightsData.from_json_list(data)
        return None
    except (json.JSONDecodeError, ValueError):
        return None
