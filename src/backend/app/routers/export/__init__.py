"""
Export router package.

This package organizes export endpoints into logical sub-modules:
- framing: Crop, upscale, and working video exports
- overlay: Highlight overlays and final video exports
- multi_clip: Multi-clip concatenation with transitions

Each sub-module handles a specific aspect of the export workflow.

Usage in main.py:
    from app.routers.export import router as export_router
    app.include_router(export_router)
"""

from fastapi import APIRouter

from .framing import router as framing_router
from .overlay import router as overlay_router
from .multi_clip import router as multi_clip_router
from .before_after import router as before_after_router

# Create main export router
router = APIRouter(prefix="/api/export", tags=["export"])

# Include all sub-routers
router.include_router(framing_router)
router.include_router(overlay_router)
router.include_router(multi_clip_router)
router.include_router(before_after_router)

__all__ = ['router']
