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
import re
import signal
import subprocess
import logging
import time
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
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("grpc").setLevel(logging.WARNING)
logging.getLogger("botocore").setLevel(logging.WARNING)
logging.getLogger("boto3").setLevel(logging.WARNING)
logging.getLogger("s3transfer").setLevel(logging.WARNING)

# Import routers and websocket handler
from app.routers import health_router, export_router, detection_router, annotate_router, projects_router, clips_router, games_router, games_upload_router, downloads_router, auth_router, storage_router, settings_router, profiles_router
from app.routers.exports import router as exports_router
from app.websocket import websocket_export_progress, websocket_extractions
from app.services.export_worker import recover_orphaned_jobs
from app.user_context import set_current_user_id, get_current_user_id
from app.session_init import user_session_init
from app.constants import DEFAULT_USER_ID
from app.middleware import RequestContextMiddleware

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
_cors_extra = os.getenv("CORS_ORIGINS", "")
_cors_origins = [
    "http://localhost:5173",  # Vite dev server
    "http://localhost:3000",  # Alternative port
]
if _cors_extra:
    _cors_origins.extend(origin.strip() for origin in _cors_extra.split(",") if origin.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Sync-Status"],
)

# Single combined middleware for user context + R2 sync.
# Must be ONE middleware because BaseHTTPMiddleware's call_next() copies the
# asyncio context. Separate middlewares can't share ContextVar state across
# the call_next() boundary. See db_sync.py for details.
app.add_middleware(RequestContextMiddleware)

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
app.include_router(profiles_router)
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


def _graceful_shutdown(signum, frame):
    """Handle SIGTERM for graceful shutdown: checkpoint WAL and sync databases to R2."""
    shutdown_start = time.perf_counter()
    logger.info("[Shutdown] SIGTERM received, starting graceful shutdown")

    try:
        from app.database import USER_DATA_BASE
        from app.storage import R2_ENABLED

        if not R2_ENABLED:
            logger.info("[Shutdown] R2 not enabled, skipping sync")
            sys.exit(0)

        # Find all user database files and checkpoint + sync each
        synced = 0
        failed = 0
        if USER_DATA_BASE.exists():
            import sqlite3
            from app.storage import sync_database_to_r2_with_version
            from app.database import get_local_db_version, set_local_db_version

            for db_file in USER_DATA_BASE.glob("*/profiles/*/database.sqlite"):
                parts = db_file.relative_to(USER_DATA_BASE).parts
                user_id = parts[0]
                profile_id = parts[2]
                try:
                    # WAL checkpoint
                    conn = sqlite3.connect(str(db_file))
                    pages = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                    conn.close()
                    logger.info(f"[Shutdown] WAL checkpoint for user={user_id} profile={profile_id}: {pages}")

                    # Sync to R2
                    version = get_local_db_version(user_id, profile_id)
                    success, new_version = sync_database_to_r2_with_version(user_id, db_file, version)
                    if success:
                        synced += 1
                    else:
                        failed += 1
                        logger.warning(f"[Shutdown] R2 sync failed for user={user_id} profile={profile_id}")
                except Exception as e:
                    failed += 1
                    logger.error(f"[Shutdown] Error syncing user={user_id} profile={profile_id}: {e}")

        elapsed = time.perf_counter() - shutdown_start
        logger.info(f"[Shutdown] Graceful shutdown completed in {elapsed:.2f}s ({synced} synced, {failed} failed)")

    except Exception as e:
        logger.error(f"[Shutdown] Error during graceful shutdown: {e}")

    sys.exit(0)


@app.on_event("startup")
async def startup_event():
    """Log version information on startup and register signal handlers"""
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

    # Register SIGTERM handler for graceful shutdown (Fly.io sends SIGTERM before stopping)
    if not IS_DEV:
        signal.signal(signal.SIGTERM, _graceful_shutdown)
        logger.info("SIGTERM handler registered for graceful shutdown")

    # Log R2 restore status
    from app.storage import R2_ENABLED as _r2
    if _r2:
        logger.info("[Startup] R2 enabled — databases will be lazy-restored from R2 on first user request")
    else:
        logger.info("[Startup] R2 disabled — using local database only")

    # Initialize the default user session (profile + database).
    # This ensures startup tasks that need DB access have a profile context.
    from app.user_context import set_current_user_id as _set_user
    _set_user(DEFAULT_USER_ID)
    user_session_init(DEFAULT_USER_ID)
    logger.info(f"Default user '{DEFAULT_USER_ID}' session initialized")

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
