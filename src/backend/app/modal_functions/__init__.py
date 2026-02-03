"""
Modal GPU functions for video processing.

This package contains Modal functions that run on remote GPUs
for video export processing.

Available functions:
    - render_overlay: Apply highlight overlays to video (GPU - required for performance)
    - process_framing_ai: Crop with Real-ESRGAN AI upscaling (GPU - required for AI)
    - extract_clip_modal: Extract clips from raw footage (CPU)
    - create_annotated_compilation: Create annotated video compilations (CPU)
"""

from .video_processing import app, render_overlay, process_framing_ai

__all__ = ["app", "render_overlay", "process_framing_ai"]
