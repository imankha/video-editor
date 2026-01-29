"""
Modal GPU functions for video processing.

This package contains Modal functions that run on remote GPUs
for video export processing.

Available functions:
    - render_overlay: Apply highlight overlays to video
    - process_framing: Crop, trim, and speed adjustments
"""

from .video_processing import app, render_overlay, process_framing

__all__ = ["app", "render_overlay", "process_framing"]
