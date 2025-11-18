"""
AI Video Upscaler Package

Modular implementation of AI-powered video upscaling with Real-ESRGAN support.
"""

from . import utils
from .video_encoder import VideoEncoder
from .keyframe_interpolator import KeyframeInterpolator

__all__ = ['utils', 'VideoEncoder', 'KeyframeInterpolator']
