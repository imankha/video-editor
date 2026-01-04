"""
Clip Processing Pipeline - Enforces correct order of processing steps.

This module addresses the Temporal Coupling code smell by making the
processing order explicit and enforceable through a pipeline pattern.

The pipeline stages are:
1. INIT: Pipeline created with clip data
2. SAVED: Video saved to temp file, content hash computed
3. CONFIGURED: Keyframes and segment data prepared
4. CACHE_CHECKED: Cache lookup performed
5. PROCESSED: Video processed (or cache hit used)
6. CACHED: Result stored in cache

USAGE:
    pipeline = ClipProcessingPipeline(clip_data, video_content, temp_dir)
    pipeline.save_to_temp()
    pipeline.configure_processing(target_fps, export_mode, include_audio)

    if pipeline.check_cache():
        output = pipeline.get_cached_result()
    else:
        output = await pipeline.process(upscaler, progress_callback)
        pipeline.store_in_cache()

    return output
"""

import os
import hashlib
import shutil
import logging
from enum import Enum, auto
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Callable
from pathlib import Path

logger = logging.getLogger(__name__)


class PipelineStage(Enum):
    """Processing pipeline stages in order."""
    INIT = auto()
    SAVED = auto()
    CONFIGURED = auto()
    CACHE_CHECKED = auto()
    PROCESSED = auto()
    CACHED = auto()


class PipelineError(Exception):
    """Raised when pipeline operations are called out of order."""
    pass


@dataclass
class ClipProcessingContext:
    """
    Context holding all data needed for clip processing.

    This replaces passing many parameters through function calls
    and ensures all required data is available at each stage.
    """
    # Input data (set at INIT)
    clip_index: int
    clip_data: Dict[str, Any]
    video_content: bytes
    temp_dir: str

    # Paths (set at SAVED)
    input_path: Optional[str] = None
    output_path: Optional[str] = None
    content_identity: Optional[str] = None

    # Processing config (set at CONFIGURED)
    keyframes: List[Dict[str, Any]] = field(default_factory=list)
    segment_data: Optional[Dict[str, Any]] = None
    target_fps: int = 30
    export_mode: str = "quality"
    include_audio: bool = True

    # Cache data (set at CACHE_CHECKED)
    cache_key: Optional[str] = None
    cache_hit: bool = False
    cached_path: Optional[str] = None


class ClipProcessingPipeline:
    """
    Pipeline for processing a single video clip.

    Enforces that operations happen in the correct order:
    1. save_to_temp() - Save video and compute hash
    2. configure_processing() - Set up keyframes and segments
    3. check_cache() - Look for cached result
    4. process() or use cached - Do the actual work
    5. store_in_cache() - Cache the result

    Each method validates that prerequisites are met before proceeding.

    Example:
        pipeline = ClipProcessingPipeline(clip_data, content, temp_dir)
        pipeline.save_to_temp()
        pipeline.configure_processing(fps=30, mode="quality", audio=True)

        if pipeline.check_cache(cache):
            result = pipeline.output_path  # Use cached
        else:
            result = await pipeline.process(upscaler, callback)
            pipeline.store_in_cache(cache)
    """

    def __init__(
        self,
        clip_data: Dict[str, Any],
        video_content: bytes,
        temp_dir: str
    ):
        """
        Initialize pipeline with clip data.

        Args:
            clip_data: Clip configuration with clipIndex, cropKeyframes, segments, etc.
            video_content: Raw video bytes
            temp_dir: Directory for temporary files
        """
        self._stage = PipelineStage.INIT
        self._context = ClipProcessingContext(
            clip_index=clip_data.get('clipIndex', 0),
            clip_data=clip_data,
            video_content=video_content,
            temp_dir=temp_dir
        )

    @property
    def stage(self) -> PipelineStage:
        """Current pipeline stage."""
        return self._stage

    @property
    def output_path(self) -> Optional[str]:
        """Output path (available after CACHE_CHECKED or PROCESSED)."""
        return self._context.output_path

    @property
    def context(self) -> ClipProcessingContext:
        """Access the processing context."""
        return self._context

    def _require_stage(self, *required_stages: PipelineStage) -> None:
        """Validate that we're at one of the required stages."""
        if self._stage not in required_stages:
            stage_names = [s.name for s in required_stages]
            raise PipelineError(
                f"Operation requires stage {stage_names}, "
                f"but pipeline is at {self._stage.name}"
            )

    def _advance_to(self, new_stage: PipelineStage) -> None:
        """Advance to a new stage."""
        self._stage = new_stage

    def save_to_temp(self) -> str:
        """
        Stage 1: Save video to temp file and compute content hash.

        Returns:
            Path to saved input file

        Raises:
            PipelineError: If not at INIT stage
        """
        self._require_stage(PipelineStage.INIT)

        ctx = self._context

        # Save video to temp
        ctx.input_path = os.path.join(ctx.temp_dir, f"input_{ctx.clip_index}.mp4")
        with open(ctx.input_path, 'wb') as f:
            f.write(ctx.video_content)

        # Compute content hash for cache key (first 1MB + size for speed)
        content_sample = ctx.video_content[:1024 * 1024]
        content_hash = hashlib.sha256(content_sample).hexdigest()[:12]
        ctx.content_identity = f"{content_hash}|{len(ctx.video_content)}"

        # Set output path
        ctx.output_path = os.path.join(ctx.temp_dir, f"processed_{ctx.clip_index}.mp4")

        self._advance_to(PipelineStage.SAVED)
        logger.debug(f"[Pipeline] Clip {ctx.clip_index}: Saved to temp, hash={content_hash[:8]}")

        return ctx.input_path

    def configure_processing(
        self,
        target_fps: int = 30,
        export_mode: str = "quality",
        include_audio: bool = True
    ) -> None:
        """
        Stage 2: Configure processing parameters.

        Converts clip_data into keyframes and segment_data formats
        expected by the AI upscaler.

        Args:
            target_fps: Output framerate
            export_mode: "quality" or "speed"
            include_audio: Whether to include audio

        Raises:
            PipelineError: If not at SAVED stage
        """
        self._require_stage(PipelineStage.SAVED)

        ctx = self._context
        ctx.target_fps = target_fps
        ctx.export_mode = export_mode
        ctx.include_audio = include_audio

        # Convert crop keyframes to expected format
        ctx.keyframes = [
            {
                'time': kf['time'],
                'x': kf['x'],
                'y': kf['y'],
                'width': kf['width'],
                'height': kf['height']
            }
            for kf in ctx.clip_data.get('cropKeyframes', [])
        ]

        # Build segment_data from clip's segments
        segments = ctx.clip_data.get('segments')
        trim_range = ctx.clip_data.get('trimRange')

        if segments or trim_range:
            ctx.segment_data = {}

            if trim_range:
                ctx.segment_data['trim_start'] = trim_range.get('start', 0)
                ctx.segment_data['trim_end'] = trim_range.get('end', ctx.clip_data.get('duration', 0))

            # Convert segment speeds if present
            if segments and segments.get('segmentSpeeds'):
                boundaries = segments.get('boundaries', [])
                speeds = segments.get('segmentSpeeds', {})

                segment_list = []
                for i in range(len(boundaries) - 1):
                    segment_list.append({
                        'start': boundaries[i],
                        'end': boundaries[i + 1],
                        'speed': speeds.get(str(i), 1.0)
                    })
                ctx.segment_data['segments'] = segment_list

        self._advance_to(PipelineStage.CONFIGURED)
        logger.debug(f"[Pipeline] Clip {ctx.clip_index}: Configured with {len(ctx.keyframes)} keyframes")

    def check_cache(self, cache) -> bool:
        """
        Stage 3: Check cache for existing result.

        Args:
            cache: ClipCache instance

        Returns:
            True if cache hit, False if cache miss

        Raises:
            PipelineError: If not at CONFIGURED stage
        """
        self._require_stage(PipelineStage.CONFIGURED)

        ctx = self._context

        # Generate cache key
        ctx.cache_key = cache.generate_key(
            cache_type='framing',
            video_id=ctx.content_identity,
            crop_keyframes=ctx.keyframes,
            segment_data=ctx.segment_data,
            target_fps=ctx.target_fps,
            export_mode=ctx.export_mode,
            include_audio=ctx.include_audio
        )

        # Check cache
        ctx.cached_path = cache.get(ctx.cache_key)
        ctx.cache_hit = ctx.cached_path is not None

        if ctx.cache_hit:
            # Copy cached result to output path
            shutil.copy2(ctx.cached_path, ctx.output_path)
            logger.info(f"[Pipeline] Clip {ctx.clip_index}: Cache HIT")
        else:
            logger.info(f"[Pipeline] Clip {ctx.clip_index}: Cache MISS, processing needed")

        self._advance_to(PipelineStage.CACHE_CHECKED)
        return ctx.cache_hit

    async def process(
        self,
        upscaler,
        progress_callback: Optional[Callable] = None
    ) -> str:
        """
        Stage 4: Process the video (only if cache miss).

        Args:
            upscaler: AIVideoUpscaler instance
            progress_callback: Optional progress callback

        Returns:
            Path to processed output

        Raises:
            PipelineError: If not at CACHE_CHECKED stage or if cache hit
        """
        self._require_stage(PipelineStage.CACHE_CHECKED)

        ctx = self._context

        if ctx.cache_hit:
            # Already have result from cache
            self._advance_to(PipelineStage.PROCESSED)
            return ctx.output_path

        # Import here to avoid circular imports
        import asyncio

        logger.info(f"[Pipeline] Clip {ctx.clip_index}: Processing with {len(ctx.keyframes)} keyframes")

        # Process with AIVideoUpscaler
        await asyncio.to_thread(
            upscaler.process_video_with_upscale,
            input_path=ctx.input_path,
            output_path=ctx.output_path,
            keyframes=ctx.keyframes,
            target_fps=ctx.target_fps,
            export_mode=ctx.export_mode,
            progress_callback=progress_callback,
            segment_data=ctx.segment_data,
            include_audio=ctx.include_audio
        )

        self._advance_to(PipelineStage.PROCESSED)
        return ctx.output_path

    def store_in_cache(self, cache) -> bool:
        """
        Stage 5: Store result in cache (only if was a cache miss).

        Args:
            cache: ClipCache instance

        Returns:
            True if stored, False if skipped (cache hit) or failed

        Raises:
            PipelineError: If not at PROCESSED stage
        """
        self._require_stage(PipelineStage.PROCESSED)

        ctx = self._context

        if ctx.cache_hit:
            # Was a cache hit, nothing to store
            self._advance_to(PipelineStage.CACHED)
            return False

        try:
            cache.put(ctx.output_path, ctx.cache_key)
            logger.info(f"[Pipeline] Clip {ctx.clip_index}: Cached result")
            self._advance_to(PipelineStage.CACHED)
            return True
        except Exception as e:
            logger.warning(f"[Pipeline] Clip {ctx.clip_index}: Failed to cache: {e}")
            self._advance_to(PipelineStage.CACHED)
            return False


async def process_clip_with_pipeline(
    clip_data: Dict[str, Any],
    video_content: bytes,
    temp_dir: str,
    target_fps: int,
    export_mode: str,
    include_audio: bool,
    cache,
    upscaler,
    progress_callback: Optional[Callable] = None
) -> str:
    """
    High-level function to process a clip using the pipeline.

    This is a convenience wrapper that runs all pipeline stages
    in the correct order.

    Args:
        clip_data: Clip configuration
        video_content: Raw video bytes
        temp_dir: Temp directory path
        target_fps: Output framerate
        export_mode: "quality" or "speed"
        include_audio: Whether to include audio
        cache: ClipCache instance
        upscaler: AIVideoUpscaler instance
        progress_callback: Optional progress callback

    Returns:
        Path to processed output
    """
    pipeline = ClipProcessingPipeline(clip_data, video_content, temp_dir)

    # Stage 1: Save to temp
    pipeline.save_to_temp()

    # Stage 2: Configure
    pipeline.configure_processing(target_fps, export_mode, include_audio)

    # Stage 3: Check cache
    if pipeline.check_cache(cache):
        # Cache hit - report and return
        if progress_callback:
            progress_callback(1, 1, "Using cached result", 'cached')
        return pipeline.output_path

    # Stage 4: Process
    output = await pipeline.process(upscaler, progress_callback)

    # Stage 5: Store in cache
    pipeline.store_in_cache(cache)

    return output
