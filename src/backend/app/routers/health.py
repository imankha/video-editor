"""
Health and status endpoints for the Video Editor API.

This router handles health checks, status endpoints, and the hello world endpoint.
"""

from fastapi import APIRouter, HTTPException
from datetime import datetime

from ..models import HelloResponse
from ..websocket import export_progress
from ..database import is_database_initialized, get_database_path, get_user_data_path

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
    """Health check with database status"""
    return {
        "status": "healthy",
        "db_initialized": is_database_initialized(),
        "db_path": str(get_database_path()),
        "user_data_path": str(get_user_data_path())
    }


@router.get("/api/export/progress/{export_id}")
async def get_export_progress(export_id: str):
    """
    Get the progress of an ongoing export operation (legacy - use WebSocket instead)
    """
    if export_id not in export_progress:
        raise HTTPException(status_code=404, detail="Export ID not found")

    return export_progress[export_id]
