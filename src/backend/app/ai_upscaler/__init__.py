"""
AI Video Upscaler Package

Modular implementation of AI-powered video upscaling with Real-ESRGAN support.
"""

from . import utils
from .video_encoder import VideoEncoder
from .keyframe_interpolator import KeyframeInterpolator
from .model_manager import ModelManager

__all__ = ['utils', 'VideoEncoder', 'KeyframeInterpolator', 'ModelManager']
