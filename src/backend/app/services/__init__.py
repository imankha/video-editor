# Services package

# Import LocalGPUProcessor to register it with the factory
from app.services import local_gpu_processor  # noqa: F401
from app.services.clip_cache import ClipCache, get_clip_cache
from app.services.ffmpeg_service import (
    concatenate_clips,
    extract_clip,
    get_ffmpeg_version,
    get_video_duration,
    get_video_info,
    is_ffmpeg_available,
)
from app.services.image_extractor import (
    extract_player_image,
    extract_player_images_for_region,
    get_image_url,
    list_highlight_images,
)
from app.services.transitions import (
    CutTransition,
    DissolveTransition,
    FadeTransition,
    TransitionFactory,
    TransitionStrategy,
    apply_transition,
)
from app.services.video_processor import (
    ProcessingBackend,
    ProcessingConfig,
    ProcessingResult,
    ProcessorFactory,
    ProgressCallback,
    VideoProcessor,
)

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
    # Transition strategies
    'TransitionStrategy',
    'TransitionFactory',
    'CutTransition',
    'FadeTransition',
    'DissolveTransition',
    'apply_transition',
    # Image extraction for highlights
    'extract_player_image',
    'extract_player_images_for_region',
    'get_image_url',
    'list_highlight_images',
]
