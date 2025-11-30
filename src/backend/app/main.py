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
"""

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import traceback
import sys
import os
import subprocess
import logging

# Configure logging with timestamps
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Import routers and websocket handler
from app.routers import health_router, export_router
from app.websocket import websocket_export_progress

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
)

# Include routers
app.include_router(health_router)
app.include_router(export_router)


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
