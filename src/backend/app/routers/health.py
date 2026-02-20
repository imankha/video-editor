"""
Health and status endpoints for the Video Editor API.

This router handles health checks, status endpoints, and the hello world endpoint.
"""

from fastapi import APIRouter, HTTPException
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

from ..models import HelloResponse
from ..websocket import export_progress
from ..database import is_database_initialized, get_database_path, get_user_data_path, sync_db_to_cloud
from ..middleware.db_sync import is_sync_failed, set_sync_failed
from ..user_context import get_current_user_id
from ..storage import R2_ENABLED

router = APIRouter(tags=["health"])


@router.get("/")
async def root():
    """Root endpoint - API info"""
    return {
        "message": "Video Editor API is running!",
        "version": "0.1.0",
        "status": "healthy",
        "docs": "/docs"
    }


@router.get("/api/hello", response_model=HelloResponse)
async def hello_world():
    """
    Hello World endpoint that demonstrates:
    - FastAPI (Python web framework)
    - Pydantic (data validation)
    - Async/await support
    """
    return HelloResponse(
        message="Hello from FastAPI + Python!",
        timestamp=datetime.now().isoformat(),
        tech_stack={
            "backend": "FastAPI",
            "language": "Python 3.11+",
            "async": True,
            "validation": "Pydantic"
        },
        fun_fact="FastAPI is one of the fastest Python frameworks, thanks to Starlette and Pydantic!"
    )


@router.get("/api/status")
async def get_status():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "video-editor-api",
        "timestamp": datetime.now().isoformat()
    }


@router.get("/api/health")
async def health_check():
    """Health check with database status.

    Works without X-Profile-ID header — reports profile-scoped DB status
    only when profile context is available.
    """
    from ..profile_context import get_current_profile_id
    try:
        profile_id = get_current_profile_id()
        db_info = {
            "db_initialized": is_database_initialized(),
            "db_path": str(get_database_path()),
            "user_data_path": str(get_user_data_path()),
        }
    except RuntimeError:
        db_info = {
            "db_initialized": None,
            "db_path": None,
            "user_data_path": None,
            "note": "No X-Profile-ID header — call /api/auth/init first",
        }

    return {
        "status": "healthy",
        **db_info,
    }


@router.post("/api/retry-sync")
async def retry_sync():
    """
    Manually retry syncing the local database to R2.

    Called by frontend when user clicks the sync failure indicator.
    Returns success/failure so the UI can update accordingly.
    """
    if not R2_ENABLED:
        return {"success": True, "message": "R2 not enabled, no sync needed"}

    user_id = get_current_user_id()
    logger.info(f"[SYNC] Manual retry requested by user {user_id}")
    success = sync_db_to_cloud()

    if success:
        set_sync_failed(user_id, False)
        return {"success": True}
    else:
        return {"success": False, "message": "Sync to R2 failed"}


@router.get("/api/export/progress/{export_id}")
async def get_export_progress(export_id: str):
    """
    Get the progress of an ongoing export operation (legacy - use WebSocket instead)
    """
    if export_id not in export_progress:
        raise HTTPException(status_code=404, detail="Export ID not found")

    return export_progress[export_id]
