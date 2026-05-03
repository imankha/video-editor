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
import logging.handlers
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

# T2020: File-based log retention — survives Fly.io's ~47-line buffer limit
LOG_DIR = Path("/tmp/logs")
LOG_DIR.mkdir(parents=True, exist_ok=True)
_file_handler = logging.handlers.TimedRotatingFileHandler(
    LOG_DIR / "app.log", when="midnight", backupCount=1, encoding="utf-8"
)
_file_handler.setFormatter(logging.Formatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
))
logging.getLogger().addHandler(_file_handler)

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
from app.routers import health_router, export_router, detection_router, projects_router, clips_router, games_router, games_upload_router, downloads_router, auth_router, storage_router, settings_router, profiles_router, credits_router, quests_router, admin_router, payments_router, gallery_shares_router, shared_router
from app.routers.exports import router as exports_router
from app.websocket import websocket_export_progress
from app.user_context import set_current_user_id, get_current_user_id
from app.session_init import user_session_init
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
app.include_router(projects_router)
app.include_router(clips_router)
app.include_router(games_router)
app.include_router(games_upload_router)
app.include_router(downloads_router)
app.include_router(auth_router)
app.include_router(storage_router)
app.include_router(settings_router)
app.include_router(profiles_router)
app.include_router(credits_router, prefix="/api")
app.include_router(quests_router, prefix="/api")
app.include_router(exports_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(payments_router, prefix="/api")
app.include_router(gallery_shares_router)
app.include_router(shared_router)

# T1530/T1531: debug endpoints (profile listing/reading). Gated internally
# by DEBUG_ENDPOINTS_ENABLED=true.
from app.routers._debug import router as _debug_router
app.include_router(_debug_router, prefix="/api")


# WebSocket endpoint for export progress
@app.websocket("/ws/export/{export_id}")
async def ws_export_progress(websocket: WebSocket, export_id: str):
    """WebSocket endpoint for real-time export progress updates"""
    await websocket_export_progress(websocket, export_id)


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

        # T405: Auth DB — sessions are ephemeral, no sync needed on shutdown

        # Find all user database files and checkpoint + sync each
        synced = 0
        failed = 0
        if USER_DATA_BASE.exists():
            import sqlite3
            from app.storage import sync_database_to_r2_with_version
            from app.database import get_local_db_version, set_local_db_version

            for db_file in USER_DATA_BASE.glob("*/profiles/*/profile.sqlite"):
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
                    success, new_version = sync_database_to_r2_with_version(user_id, db_file, version, skip_version_check=True)
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

    # T1570: Auto-enable profiling in dev/staging
    from app.profiling import profile_on_breach_enabled
    if ENV in ("development", "staging") and not os.getenv("PROFILE_ON_BREACH_ENABLED"):
        os.environ["PROFILE_ON_BREACH_ENABLED"] = "true"
        os.environ.setdefault("PROFILE_ON_BREACH_MS", "500")
        os.environ.setdefault("DEBUG_ENDPOINTS_ENABLED", "true")
        logger.info("[PROFILE] Auto-enabled profiling for dev/staging (threshold=500ms)")
    if profile_on_breach_enabled():
        from app.profiling import profile_breach_ms
        logger.info(f"[PROFILE] Profiling enabled (breach threshold={profile_breach_ms()}ms)")

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

    # T405: Initialize central auth database.
    # T1290: Restore is mandatory when R2 is enabled — if the R2 fetch fails
    # after 3 attempts we raise and let Fly.io restart the process rather
    # than silently come up with an empty auth DB (which wipes every
    # session and email→user_id record).
    from app.services.auth_db import restore_auth_db_or_fail
    restore_auth_db_or_fail()
    logger.info("[Startup] Central auth DB initialized")

    from app.services.sharing_db import restore_sharing_db_or_fail
    restore_sharing_db_or_fail()
    logger.info("[Startup] Sharing DB initialized")

    # Default user 'a' init removed — all users now go through auth.
    # Profile context is set per-request by the middleware.

    # T1380 + T1390: orphaned-job recovery and modal queue drain are deferred to
    # each user's first request of this server process (see session_init.py).
    # Boot-time iteration over all users does not scale — most users have no
    # pending work, and per-user R2 restore at boot would dominate cold start.
    logger.info(
        "[Startup] orphaned-job recovery + modal queue drain deferred to "
        "per-user first request (runs once per user via user_session_init)"
    )

    # T1583: Start background sweep loop for auto-export + R2 cleanup
    from app.services.sweep_scheduler import start_sweep_loop
    await start_sweep_loop()


@app.on_event("shutdown")
async def shutdown_event():
    from app.services.sweep_scheduler import stop_sweep_loop
    await stop_sweep_loop()


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
