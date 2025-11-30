"""
Pydantic models for the Video Editor API.

This module contains all data models used for request/response validation.
"""

from pydantic import BaseModel
from typing import List


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
    keyframes: List[CropKeyframe]


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
    keyframes: List[HighlightKeyframe]
