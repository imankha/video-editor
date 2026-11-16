# Services package

from app.services.clip_cache import ClipCache, get_clip_cache
from app.services.ffmpeg_service import (
    concatenate_clips,
    extract_clip,
    get_ffmpeg_version,
    get_video_duration,
    is_ffmpeg_available,
)

__all__ = [
    # Clip cache
    'ClipCache',
    'get_clip_cache',
    # FFmpeg utilities
    'is_ffmpeg_available',
    'get_ffmpeg_version',
    'get_video_duration',
    'concatenate_clips',
    'extract_clip',
]
