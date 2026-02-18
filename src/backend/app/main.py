"""
Video Editor Backend API - Main Application Entry Point

This is the main FastAPI application that serves as the entry point for the
video editor backend. It configures CORS, exception handling, and includes
all routers for the API endpoints.

Architecture:
- main.py: App initialization, middleware, startup (this file)
- models.py: Pydantic models for request/response validation
- websocket.py: WebSocket connection management for real-time progress
- interpolation.py: Crop interpolation utilities for FFmpeg
- routers/health.py: Health check and status endpoints
- routers/export.py: Video export endpoints (crop, upscale, overlay)
- routers/detection.py: YOLO-based object detection endpoints
"""

from fastapi import FastAPI, WebSocket, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import traceback
import sys
import os
import subprocess
import logging
from dotenv import load_dotenv

# Load environment variables from .env file (if exists)
# Look in project root (two levels up from app/)
from pathlib import Path
_project_root = Path(__file__).parent.parent.parent.parent
_env_file = _project_root / ".env"
if _env_file.exists():
    load_dotenv(_env_file)
else:
    load_dotenv()  # Fallback to current directory

# Configure logging with timestamps
# Use DEBUG level if DEBUG env var is set, otherwise INFO
log_level = logging.DEBUG if os.getenv("DEBUG") else logging.INFO
logging.basicConfig(
    level=log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Quiet noisy third-party libraries (only show warnings and above)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("modal").setLevel(logging.WARNING)
logging.getLogger("watchfiles").setLevel(logging.WARNING)

# Import routers and websocket handler
from app.routers import health_router, export_router, detection_router, annotate_router, projects_router, clips_router, games_router, games_upload_router, downloads_router, auth_router, storage_router, settings_router
from app.routers.exports import router as exports_router
from app.websocket import websocket_export_progress, websocket_extractions
from app.database import init_database
from app.services.export_worker import recover_orphaned_jobs
from app.user_context import set_current_user_id, get_current_user_id
from app.constants import DEFAULT_USER_ID
from app.middleware import DatabaseSyncMiddleware


class UserContextMiddleware(BaseHTTPMiddleware):
    """
    Middleware to set user context from X-User-ID header.

    This enables request-based user isolation for testing.
    In normal use (no header), the default user ID is used.
    """

    async def dispatch(self, request: Request, call_next):
        # Get user ID from header, default to 'a'
        user_id = request.headers.get('X-User-ID', DEFAULT_USER_ID)

        # Sanitize: only allow alphanumeric, underscore, dash
        sanitized = ''.join(c for c in user_id if c.isalnum() or c in '_-')
        if not sanitized:
            sanitized = DEFAULT_USER_ID

        # Set user context for this request
        set_current_user_id(sanitized)

        response = await call_next(request)
        return response

# Environment detection
ENV = os.getenv("ENV", "development")
IS_DEV = ENV == "development"

# Create FastAPI app
app = FastAPI(
    title="Video Editor API",
    version="0.1.0",
    description="Backend API for video editing application with AI upscaling"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Alternative port
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Sync-Status"],
)

# Add user context middleware (must be after CORS)
app.add_middleware(UserContextMiddleware)

# Add database sync middleware (syncs to R2 at request boundaries)
# Must be added after UserContextMiddleware so user ID is available
app.add_middleware(DatabaseSyncMiddleware)

# Include routers
app.include_router(health_router)
app.include_router(export_router)
app.include_router(detection_router)
app.include_router(annotate_router)
app.include_router(projects_router)
app.include_router(clips_router)
app.include_router(games_router)
app.include_router(games_upload_router)
app.include_router(downloads_router)
app.include_router(auth_router)
app.include_router(storage_router)
app.include_router(settings_router)
app.include_router(exports_router, prefix="/api")


# WebSocket endpoint for export progress
@app.websocket("/ws/export/{export_id}")
async def ws_export_progress(websocket: WebSocket, export_id: str):
    """WebSocket endpoint for real-time export progress updates"""
    await websocket_export_progress(websocket, export_id)


# WebSocket endpoint for extraction status updates
@app.websocket("/ws/extractions")
async def ws_extractions(websocket: WebSocket):
    """WebSocket endpoint for clip extraction status updates"""
    await websocket_extractions(websocket)


def get_git_version_info():
    """Get git commit hash and branch name for logging"""
    try:
        commit_hash = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        short_hash = subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        branch = subprocess.check_output(
            ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        commit_date = subprocess.check_output(
            ['git', 'log', '-1', '--format=%cd', '--date=iso'],
            stderr=subprocess.DEVNULL,
            text=True
        ).strip()

        dirty = subprocess.call(
            ['git', 'diff-index', '--quiet', 'HEAD', '--'],
            stderr=subprocess.DEVNULL
        ) != 0

        return {
            'commit': commit_hash,
            'short_commit': short_hash,
            'branch': branch,
            'commit_date': commit_date,
            'dirty': dirty
        }
    except Exception as e:
        logger.warning(f"Could not retrieve git version info: {e}")
        return None


@app.on_event("startup")
async def startup_event():
    """Log version information on startup"""
    logger.info("=" * 80)
    logger.info("VIDEO EDITOR BACKEND STARTING")
    logger.info("=" * 80)

    git_info = get_git_version_info()
    if git_info:
        logger.info("Git Version Information:")
        logger.info(f"  Branch: {git_info['branch']}")
        logger.info(f"  Commit: {git_info['short_commit']} ({git_info['commit'][:12]}...)")
        logger.info(f"  Date: {git_info['commit_date']}")
        if git_info['dirty']:
            logger.warning("  Status: DIRTY (uncommitted changes present)")
        else:
            logger.info("  Status: Clean")
    else:
        logger.info("Git version info not available")

    logger.info(f"Environment: {ENV}")
    logger.info(f"Python version: {sys.version.split()[0]}")
    logger.info("=" * 80)

    # Initialize database
    try:
        init_database()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        raise

    # Recover any orphaned export jobs from previous server run
    try:
        await recover_orphaned_jobs()
        logger.info("Orphaned export jobs recovery complete")
    except Exception as e:
        logger.warning(f"Failed to recover orphaned jobs: {e}")

    # Process any pending modal tasks from previous server run
    try:
        from app.services.modal_queue import process_modal_queue
        result = await process_modal_queue()
        if result.get("processed", 0) > 0:
            logger.info(f"Modal queue processed: {result['succeeded']} succeeded, {result['failed']} failed")
        else:
            logger.info("Modal queue: no pending tasks found")
    except Exception as e:
        logger.warning(f"Failed to process modal queue: {e}")


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """
    Global exception handler that provides detailed errors in dev mode
    and sanitized errors in production
    """
    if IS_DEV:
        error_detail = {
            "error": type(exc).__name__,
            "message": str(exc),
            "traceback": traceback.format_exception(type(exc), exc, exc.__traceback__),
            "request_url": str(request.url),
            "method": request.method
        }
        return JSONResponse(status_code=500, content=error_detail)
    else:
        return JSONResponse(
            status_code=500,
            content={
                "error": "Internal Server Error",
                "message": "An error occurred while processing your request"
            }
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
