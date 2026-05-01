"""
API Routers for the Video Editor backend.

This package contains FastAPI routers organized by functionality:
- health.py: Health check and status endpoints
- export/: Video export endpoints (split into framing, overlay, multi_clip sub-modules)
- detection.py: YOLO-based object detection endpoints
- projects.py: Project CRUD endpoints
- clips.py: Clip library and working clips endpoints
- games.py: Game storage and management endpoints
- games_upload.py: T80 - Deduplicated game upload with multipart support
- downloads.py: Final video downloads management
- auth.py: User login for test isolation
- storage.py: Presigned URL generation for R2 direct access
"""

from .health import router as health_router
from .export import router as export_router
from .detection import router as detection_router
from .projects import router as projects_router
from .clips import router as clips_router
from .games import router as games_router
from .games_upload import router as games_upload_router
from .downloads import router as downloads_router
from .auth import router as auth_router
from .storage import router as storage_router
from .settings import router as settings_router
from .profiles import router as profiles_router
from .credits import router as credits_router
from .quests import router as quests_router
from .admin import router as admin_router
from .payments import router as payments_router
from .shares import gallery_shares_router, shared_router

__all__ = ['health_router', 'export_router', 'detection_router', 'projects_router', 'clips_router', 'games_router', 'games_upload_router', 'downloads_router', 'auth_router', 'storage_router', 'settings_router', 'profiles_router', 'credits_router', 'quests_router', 'admin_router', 'payments_router', 'gallery_shares_router', 'shared_router']
