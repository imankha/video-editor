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

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Shared hex-color validation pattern (project rule: no silent fallback/clamp for
# internal data — an invalid hex must raise, never be coerced or defaulted).
_HEX_COLOR_PATTERN = r"^#[0-9A-Fa-f]{6}$"

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
    keyframes: list[CropKeyframe] = Field(
        default_factory=list,
        description="Array of crop keyframes sorted by frame"
    )

    @classmethod
    def from_json_list(cls, json_list: list[dict]) -> 'CropData':
        """Create CropData from a raw JSON list (the format stored in DB)."""
        return cls(keyframes=[CropKeyframe(**kf) for kf in json_list])

    def to_json_list(self) -> list[dict]:
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
    trimRange: tuple[float, float] | None = Field(
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
    boundaries: list[float] = Field(
        default_factory=lambda: [0.0],
        description="Sorted list of segment boundary times in seconds. "
                    "First element is always 0, last is video duration."
    )
    userSplits: list[float] = Field(
        default_factory=list,
        description="User-created split points (subset of boundaries)"
    )
    trimRange: tuple[float, float] | None = Field(
        default=None,
        description="Active trim range [start, end] in seconds"
    )
    segmentSpeeds: dict[str, float] = Field(
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
    time: float | None = Field(
        default=None,
        description="Time in seconds (used in export/storage format)"
    )
    frame: int | None = Field(
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
        default='#FFFFFF',
        description="Highlight color as hex string (e.g., '#FFFFFF' for white)"
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
    start_time: float | None = Field(
        default=None,
        description="Region start time in seconds (snake_case for storage)"
    )
    end_time: float | None = Field(
        default=None,
        description="Region end time in seconds (snake_case for storage)"
    )

    # Alternative camelCase format (for internal/frontend format)
    startTime: float | None = Field(
        default=None,
        description="Region start time in seconds (camelCase for frontend)"
    )
    endTime: float | None = Field(
        default=None,
        description="Region end time in seconds (camelCase for frontend)"
    )

    enabled: bool = Field(
        default=True,
        description="Whether this region's highlight effect is active"
    )

    keyframes: list[HighlightKeyframe] = Field(
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
    regions: list[HighlightRegion] = Field(
        default_factory=list,
        description="Array of highlight regions"
    )

    @classmethod
    def from_json_list(cls, json_list: list[dict]) -> 'HighlightsData':
        """Create HighlightsData from a raw JSON list (the format stored in DB)."""
        return cls(regions=[HighlightRegion(**r) for r in json_list])

    def to_json_list(self) -> list[dict]:
        """Convert to raw JSON list format for DB storage."""
        return [r.model_dump(exclude_none=True) for r in self.regions]

    def get_enabled_regions(self) -> list[HighlightRegion]:
        """Get only enabled regions."""
        return [r for r in self.regions if r.enabled]


# =============================================================================
# TEXT SPEC SCHEMA (T5180 rich text engine)
# Used by: app.services.text_render.render_text_layer, RichText.jsx (frontend
# mirror in src/frontend/src/constants/textSpec.js), future consumers T5210
# (intro card) and T5225 (Overlay text layer).
#
# Replaces the vestigial pixel-based TextOverlay/TextOverlaysData (deleted, no
# writer ever existed) — TextSpec is normalised (fractions of the frame), so
# one spec renders identically-in-relative-terms at any resolution and in any
# preview box. See docs/plans/tasks/T5180-design.md §3 for the full invariant.
#
# UNIT INVARIANT (design §3, gate decision Q1 — documented ONCE here, every
# other docstring/comment points back to this block instead of restating it):
#   - `size` and `position.y` are FRAME-RELATIVE: fractions of frame HEIGHT.
#   - `maxWidth` and `position.x` are FRAME-RELATIVE: fractions of frame WIDTH.
#   - `position` is the anchor, interpreted per `align` (left/center/right);
#     `position.y` is the text block's TOP edge.
#   - `shadow.blur` and `stroke.width` are EM-RELATIVE: fractions of the
#     element's OWN `size`, NOT of the frame directly. Resolve as
#     `blur_px = spec.shadow.blur * spec.size * frame_h` and
#     `stroke_px = spec.stroke.width * spec.size * frame_h` (the `* frame_h`
#     term converts `size`'s own frame-height fraction to pixels; the
#     em-relative field is a fraction OF that resolved pixel size, not a
#     second fraction of the frame). A frame-relative stroke/blur would give a
#     small caption and a huge title the SAME absolute stroke/blur width —
#     wrong the moment a card mixes two text sizes.
# =============================================================================

class Align(str, Enum):
    """Text block horizontal alignment, interpreted relative to TextSpec.position."""
    LEFT = "left"
    CENTER = "center"
    RIGHT = "right"


class Animation(str, Enum):
    """Card-only entrance animation (T5210). The Overlay text layer (T5225)
    ignores this in v1 — it lives on the shared spec so one model serves both
    consumers without a second field set."""
    NONE = "none"
    FADE = "fade"
    FADE_UP = "fade-up"
    WIPE = "wipe"


class FontKey(str, Enum):
    """Greppable font catalogue keys — mirror app/assets/fonts/fonts.json keys
    exactly (design §4, final keys after the static-file swap). Unknown font
    keys fail loudly at this enum boundary (ValidationError), never silently
    default to a fallback face."""
    ANTON = "anton"
    OSWALD = "oswald"
    GRADUATE = "graduate"
    PLAYFAIR = "playfair"


class Position(BaseModel):
    """Frame-relative anchor point. x = fraction of frame WIDTH, y = fraction
    of frame HEIGHT. Interpreted per TextSpec.align; y is the block's TOP edge."""
    x: float = Field(..., ge=0, le=1)
    y: float = Field(..., ge=0, le=1)


class Shadow(BaseModel):
    """blur is EM-RELATIVE (fraction of the spec's own `size`, resolved as
    spec.size * frame_h) — see the unit invariant block above. blur=0 AND
    opacity=0 means no shadow; this is the default. T6620: "blur implies a
    shadow" — when blur>0 but opacity is left at 0 (the Overlay rail exposes
    only a blur slider), the renderers resolve a default opacity so the shadow
    actually draws (text_render.py::_resolve_shadow_opacity, mirrored in
    RichText.jsx). The resolution lives in the renderers, NOT here — the stored
    spec keeps the raw opacity the user set."""
    blur: float = Field(default=0, ge=0, le=0.5)
    color: str = Field(default="#000000")
    opacity: float = Field(default=0, ge=0, le=1)

    @field_validator("color")
    @classmethod
    def _validate_hex(cls, v: str) -> str:
        import re
        if not re.match(_HEX_COLOR_PATTERN, v):
            raise ValueError(f"color must be a #RRGGBB hex string, got {v!r}")
        return v


class Stroke(BaseModel):
    """width is EM-RELATIVE (fraction of the spec's own `size`, resolved as
    spec.size * frame_h) — see the unit invariant block above. Zero magnitude
    (width=0) means no stroke; this is the default."""
    width: float = Field(default=0, ge=0, le=0.15)
    color: str = Field(default="#000000")

    @field_validator("color")
    @classmethod
    def _validate_hex(cls, v: str) -> str:
        import re
        if not re.match(_HEX_COLOR_PATTERN, v):
            raise ValueError(f"color must be a #RRGGBB hex string, got {v!r}")
        return v


class TextSpec(BaseModel):
    """The shared text contract (design §3). Every dimension is normalised —
    never a pixel — so one spec renders identically-in-relative-terms at
    1080x1920, 1920x1080, and in a 150px preview box. Out-of-range values
    RAISE (ValidationError), never silently clamp (project rule: no silent
    fallback/clamp for internal data)."""
    text: str
    font: FontKey
    size: float = Field(..., gt=0, le=0.5)
    color: str
    align: Align = Align.LEFT
    position: Position
    maxWidth: float = Field(..., gt=0, le=1)
    shadow: Shadow = Field(default_factory=Shadow)
    stroke: Stroke = Field(default_factory=Stroke)
    animation: Animation = Animation.NONE

    @field_validator("color")
    @classmethod
    def _validate_hex(cls, v: str) -> str:
        import re
        if not re.match(_HEX_COLOR_PATTERN, v):
            raise ValueError(f"color must be a #RRGGBB hex string, got {v!r}")
        return v


# =============================================================================
# EFFECT TYPE ENUM
# Used in: working_videos.effect_type
# =============================================================================

EffectType = Literal['original', 'brightness_boost', 'dark_overlay']


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def parse_crop_data(raw) -> CropData | None:
    """Safely parse crop_data from DB (msgpack bytes or None)."""
    if not raw:
        return None
    try:
        from app.utils.encoding import decode_data
        data = decode_data(raw)
        if isinstance(data, list):
            return CropData.from_json_list(data)
        return None
    except Exception:
        return None


def parse_timing_data(raw) -> TimingData | None:
    """Safely parse timing_data from DB (msgpack bytes or None)."""
    if not raw:
        return None
    try:
        from app.utils.encoding import decode_data
        data = decode_data(raw)
        if isinstance(data, dict):
            return TimingData(**data)
        return None
    except Exception:
        return None


def parse_segments_data(raw) -> SegmentsData | None:
    """Safely parse segments_data from DB (msgpack bytes or None)."""
    if not raw:
        return None
    try:
        from app.utils.encoding import decode_data
        data = decode_data(raw)
        if isinstance(data, dict):
            return SegmentsData(**data)
        return None
    except Exception:
        return None


def parse_highlights_data(raw) -> HighlightsData | None:
    """Safely parse highlights_data from DB (msgpack bytes or None)."""
    if not raw:
        return None
    try:
        from app.utils.encoding import decode_data
        data = decode_data(raw)
        if isinstance(data, list):
            return HighlightsData.from_json_list(data)
        return None
    except Exception:
        return None
