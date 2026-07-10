"""
Pydantic models for the Video Editor API.

This module contains all data models used for request/response validation.
"""


from pydantic import BaseModel


# Health/Hello endpoint models
class HelloResponse(BaseModel):
    """Response model for the hello endpoint"""
    message: str
    timestamp: str
    tech_stack: dict
    fun_fact: str


# Crop Export Models
class CropKeyframe(BaseModel):
    """A single crop keyframe with position and dimensions"""
    time: float
    x: float
    y: float
    width: float
    height: float


class CropExportRequest(BaseModel):
    """Request model for crop export"""
    keyframes: list[CropKeyframe]


# Highlight Export Models
class HighlightKeyframe(BaseModel):
    """A single highlight keyframe with ellipse parameters"""
    time: float
    x: float
    y: float
    radiusX: float  # Horizontal radius of ellipse
    radiusY: float  # Vertical radius of ellipse (larger for upright players)
    opacity: float
    color: str


class HighlightExportRequest(BaseModel):
    """Request model for highlight export"""
    keyframes: list[HighlightKeyframe]


# Detection Models (YOLO)
class BoundingBox(BaseModel):
    """Bounding box coordinates"""
    x: float       # Center x
    y: float       # Center y
    width: float   # Box width
    height: float  # Box height


class Detection(BaseModel):
    """A single object detection result"""
    bbox: BoundingBox
    confidence: float
    class_name: str
    class_id: int


class PlayerDetectionRequest(BaseModel):
    """Request model for player detection on a single frame"""
    video_path: str | None = None  # Direct file path (for testing/local)
    video_id: str | None = None    # ID from /api/detect/upload (for frontend)
    # R2 video support (for Modal GPU processing)
    user_id: str | None = None     # User folder in R2
    input_key: str | None = None   # R2 key for video (relative to user folder)
    # Project-based detection (backend looks up R2 path from working_video)
    project_id: int | None = None  # Project ID to look up working video
    frame_number: int
    confidence_threshold: float | None = 0.5


class PlayerDetectionResponse(BaseModel):
    """Response model for player detection"""
    frame_number: int
    detections: list[Detection]
    video_width: int
    video_height: int


