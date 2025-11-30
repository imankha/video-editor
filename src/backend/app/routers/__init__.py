"""
API Routers for the Video Editor backend.

This package contains FastAPI routers organized by functionality:
- health.py: Health check and status endpoints
- export.py: Video export endpoints (crop, upscale, overlay)
"""

from .health import router as health_router
from .export import router as export_router

__all__ = ['health_router', 'export_router']
