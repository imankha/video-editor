# Services package

from app.services.clip_cache import ClipCache, get_clip_cache
from app.services.video_processor import (
    VideoProcessor,
    ProcessingBackend,
    ProcessingConfig,
    ProcessingResult,
    ProgressCallback,
    ProcessorFactory,
)
from app.services.ffmpeg_service import (
    is_ffmpeg_available,
    get_ffmpeg_version,
    get_video_duration,
    get_video_info,
    concatenate_clips,
    extract_clip,
)

# Import LocalGPUProcessor to register it with the factory
from app.services import local_gpu_processor  # noqa: F401

__all__ = [
    # Clip cache
    'ClipCache',
    'get_clip_cache',
    # Video processor interface
    'VideoProcessor',
    'ProcessingBackend',
    'ProcessingConfig',
    'ProcessingResult',
    'ProgressCallback',
    'ProcessorFactory',
    # FFmpeg utilities
    'is_ffmpeg_available',
    'get_ffmpeg_version',
    'get_video_duration',
    'get_video_info',
    'concatenate_clips',
    'extract_clip',
]
