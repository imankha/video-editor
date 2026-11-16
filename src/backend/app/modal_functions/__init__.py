"""
Modal GPU functions for video processing.

This package contains Modal functions that run on remote GPUs
for video export processing.

Available functions:
    - render_overlay: Apply highlight overlays to video (GPU - required for performance)
    - process_clips_ai: Unified multi-clip AI upscaling (GPU)
"""

from .video_processing import app, process_clips_ai, render_overlay

__all__ = ["app", "process_clips_ai", "render_overlay"]
