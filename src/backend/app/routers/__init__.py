"""
API Routers for the Video Editor backend.

This package contains FastAPI routers organized by functionality:
- health.py: Health check and status endpoints
- export.py: Video export endpoints (crop, upscale, overlay)
- detection.py: YOLO-based object detection endpoints
- annotate.py: Annotate mode export (extract clips from game footage)
- projects.py: Project CRUD endpoints
"""

from .health import router as health_router
from .export import router as export_router
from .detection import router as detection_router
from .annotate import router as annotate_router
from .projects import router as projects_router
from .clips import router as clips_router

__all__ = ['health_router', 'export_router', 'detection_router', 'annotate_router', 'projects_router', 'clips_router']
