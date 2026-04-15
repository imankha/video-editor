"""
Modal GPU functions for video processing.

This package contains Modal functions that run on remote GPUs
for video export processing.

Available functions:
    - render_overlay: Apply highlight overlays to video (GPU - required for performance)
    - process_framing_ai: Crop with Real-ESRGAN AI upscaling (GPU - required for AI)
    - process_clips_ai: Unified multi-clip AI upscaling (GPU)
"""

from .video_processing import app, render_overlay, process_framing_ai

__all__ = ["app", "render_overlay", "process_framing_ai"]
