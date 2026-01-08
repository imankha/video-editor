"""
API Routers for the Video Editor backend.

This package contains FastAPI routers organized by functionality:
- health.py: Health check and status endpoints
- export/: Video export endpoints (split into framing, overlay, multi_clip sub-modules)
- detection.py: YOLO-based object detection endpoints
- annotate.py: Annotate mode export (extract clips from game footage)
- projects.py: Project CRUD endpoints
- clips.py: Clip library and working clips endpoints
- games.py: Game storage and management endpoints
- downloads.py: Final video downloads management
- auth.py: User login for test isolation
"""

from .health import router as health_router
from .export import router as export_router
from .detection import router as detection_router
from .annotate import router as annotate_router
from .projects import router as projects_router
from .clips import router as clips_router
from .games import router as games_router
from .downloads import router as downloads_router
from .auth import router as auth_router

__all__ = ['health_router', 'export_router', 'detection_router', 'annotate_router', 'projects_router', 'clips_router', 'games_router', 'downloads_router', 'auth_router']
