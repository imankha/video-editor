"""
Health and status endpoints for the Video Editor API.

This router handles health checks, status endpoints, and the hello world endpoint.
"""

import logging
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException, Response

logger = logging.getLogger(__name__)

from ..database import (
    get_database_path,
    get_user_data_path,
    has_sync_pending,
    is_database_initialized,
    sync_db_to_cloud,
)
from ..middleware.db_sync import set_sync_failed
from ..models import HelloResponse
from ..storage import R2_ENABLED
from ..user_context import get_current_user_id
from ..version import APP_VERSION
from ..websocket import export_progress

router = APIRouter(tags=["health"])


@router.get("/api/version")
async def get_version(response: Response):
    """T5070: unauthenticated version handshake — lets the client (pre- or
    post-login) detect a backend-only deploy (no new service worker, so the
    normal PWA update prompt never fires) and raise the update gate.
    """
    response.headers["Cache-Control"] = "no-store"
    return {"version": APP_VERSION}


@router.post("/api/sync/flush-verify")
async def flush_verify():
    """T5070: barrier endpoint for the update-gate's step-3 durable flush.

    Being a POST (a WRITE method), RequestContextMiddleware's pending-sync
    retry (T930/T1150, db_sync.py `_sync_aware_flow`) already ran -- awaited,
    inside this user's per-request write lock -- BEFORE this handler executed.
    That retry either had nothing to do (nothing was pending) or just landed
    (or re-confirmed the failure of) any previously deferred fire-and-forget
    sync (the 0.5s upload-lock defer window, T3250). This handler makes no
    writes of its own: the barrier confirms EXISTING state landed, it does not
    create new state to sync.
    """
    user_id = get_current_user_id()
    if has_sync_pending(user_id):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "sync_failed",
                "retryable": True,
                "detail": "Could not confirm your latest changes were saved. Please try again.",
            },
        )
    return {"status": "ok"}


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
    t0 = time.perf_counter()
    from ..profile_context import get_current_profile_id
    try:
        get_current_profile_id()
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
    t1 = time.perf_counter()
    logger.info(f"[PROFILE health] handler={int((t1-t0)*1000)}ms")

    # T4120: non-secret render-mode flag for diagnostics (nothing branches on it;
    # dev-verify always runs local). Lets a worker eyeball whether a reused stack
    # is rendering locally.
    from ..services.modal_client import modal_enabled
    return {
        "status": "healthy",
        "modal_enabled": modal_enabled(),
        **db_info,
    }


@router.get("/api/debug/tasks")
async def debug_modal_tasks():
    """Debug endpoint: show modal_tasks status (for E2E test diagnostics)."""

    from ..database import get_db_connection
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, task_type, status, raw_clip_id, error,
                       created_at, started_at, completed_at
                FROM modal_tasks
                ORDER BY created_at DESC
                LIMIT 20
            """)
            tasks = []
            for row in cursor.fetchall():
                tasks.append({
                    "id": row["id"],
                    "task_type": row["task_type"],
                    "status": row["status"],
                    "raw_clip_id": row["raw_clip_id"],
                    "error": row["error"],
                    "created_at": row["created_at"],
                    "started_at": row["started_at"],
                    "completed_at": row["completed_at"],
                })
            return {"tasks": tasks}
    except Exception as e:
        return {"error": str(e)}


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
