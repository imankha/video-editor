"""
AI Video Upscaler Package

Modular implementation of AI-powered video upscaling with Real-ESRGAN support.
"""

from . import utils
from .video_encoder import VideoEncoder

__all__ = ['utils', 'VideoEncoder']
