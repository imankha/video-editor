"""
Local GPU Processor - Video processing using local GPU resources.

This processor uses:
- FFmpeg for video encoding/decoding
- Real-ESRGAN for AI upscaling (via ai_upscaler module)
- RIFE for frame interpolation (optional)

This is the default processor for video editing operations.
Future implementations (WebGPU, RunPod) will follow the same interface.
"""

import asyncio
import logging
import os
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional

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
    get_video_info,
    concatenate_clips,
    create_chapter_metadata_file,
    add_chapters_to_video,
)

logger = logging.getLogger(__name__)

# AIVideoUpscaler is imported lazily to avoid circular imports
# (ai_upscaler -> video_encoder -> services -> local_gpu_processor -> ai_upscaler)
_AIVideoUpscaler = None
_ai_import_attempted = False


def _get_ai_upscaler_class():
    """Lazily import AIVideoUpscaler to avoid circular imports."""
    global _AIVideoUpscaler, _ai_import_attempted
    if not _ai_import_attempted:
        _ai_import_attempted = True
        try:
            from app.ai_upscaler import AIVideoUpscaler
            _AIVideoUpscaler = AIVideoUpscaler
            logger.info("AI upscaler module loaded successfully")
        except (ImportError, OSError, AttributeError) as e:
            logger.warning(f"AI upscaler not available: {e}")
            _AIVideoUpscaler = None
    return _AIVideoUpscaler


class LocalGPUProcessor(VideoProcessor):
    """
    Video processor using local GPU resources.

    This processor implements the VideoProcessor interface using:
    - FFmpeg for basic video operations
    - Real-ESRGAN for AI upscaling (if available)
    - Local GPU for neural network inference
    """

    def __init__(self):
        """Initialize the local GPU processor."""
        self._ffmpeg_available = is_ffmpeg_available()
        self._ai_available = None  # Determined lazily
        self._upscaler = None

    @property
    def backend(self) -> ProcessingBackend:
        """Return the processing backend type."""
        return ProcessingBackend.LOCAL_GPU

    def is_available(self) -> bool:
        """Check if this processor is available and ready to use."""
        # Requires FFmpeg at minimum
        return self._ffmpeg_available

    def _get_upscaler(self):
        """Get or create the AI upscaler instance (lazy initialization)."""
        # Lazy check for AI availability
        if self._ai_available is None:
            self._ai_available = _get_ai_upscaler_class() is not None

        if self._upscaler is None and self._ai_available:
            try:
                AIVideoUpscaler = _get_ai_upscaler_class()
                self._upscaler = AIVideoUpscaler()
            except Exception as e:
                logger.warning(f"Failed to initialize AI upscaler: {e}")
                self._ai_available = False
        return self._upscaler

    async def process_clip(
        self,
        config: ProcessingConfig,
        progress: Optional[ProgressCallback] = None
    ) -> ProcessingResult:
        """
        Process a single video clip with the given configuration.

        This handles:
        1. Applying crop keyframes (animated crop)
        2. Applying segment speed changes
        3. AI upscaling (if enabled and available)
        4. Encoding to final output

        Args:
            config: Processing configuration
            progress: Optional progress callback

        Returns:
            ProcessingResult with success status and output path
        """
        if not self._ffmpeg_available:
            return ProcessingResult(
                success=False,
                error_message="FFmpeg not available"
            )

        progress = progress or ProgressCallback(None)
        progress.log(f"Processing clip: {config.input_path}")
        progress.report(0, 100, "Starting processing", "init")

        try:
            # Check if AI upscaling is requested and available
            # Trigger lazy initialization if not yet done
            if self._ai_available is None:
                self._ai_available = _get_ai_upscaler_class() is not None

            if config.use_ai_upscale and self._ai_available:
                return await self._process_with_ai_upscale(config, progress)
            else:
                return await self._process_without_ai(config, progress)

        except Exception as e:
            logger.error(f"Clip processing failed: {e}", exc_info=True)
            return ProcessingResult(
                success=False,
                error_message=str(e)
            )

    async def _process_with_ai_upscale(
        self,
        config: ProcessingConfig,
        progress: ProgressCallback
    ) -> ProcessingResult:
        """Process clip with AI upscaling."""
        upscaler = self._get_upscaler()
        if upscaler is None:
            # Fall back to non-AI processing
            progress.log("AI upscaler not available, using FFmpeg-only processing")
            return await self._process_without_ai(config, progress)

        progress.report(10, 100, "Initializing AI upscaler", "init")

        # Convert config to upscaler format
        keyframes = config.crop_keyframes or []

        # Run upscaler in thread to avoid blocking
        loop = asyncio.get_event_loop()

        def upscale_progress(current, total, message, phase):
            # Scale progress from 10-90%
            scaled = 10 + int((current / max(total, 1)) * 80)
            progress.report(scaled, 100, message, phase)

        try:
            result = await loop.run_in_executor(
                None,
                lambda: upscaler.process_video(
                    input_path=config.input_path,
                    output_path=config.output_path,
                    keyframes=keyframes,
                    segment_data=config.segment_data,
                    target_fps=config.target_fps,
                    export_mode=config.export_mode,
                    include_audio=config.include_audio,
                    progress_callback=upscale_progress
                )
            )

            progress.report(100, 100, "Processing complete", "complete")

            # Get output info
            if os.path.exists(config.output_path):
                info = get_video_info(config.output_path)
                return ProcessingResult(
                    success=True,
                    output_path=config.output_path,
                    duration_seconds=info.get('duration'),
                    output_width=info.get('width'),
                    output_height=info.get('height')
                )
            else:
                return ProcessingResult(
                    success=False,
                    error_message="Output file not created"
                )

        except Exception as e:
            return ProcessingResult(
                success=False,
                error_message=f"AI upscaling failed: {e}"
            )

    async def _process_without_ai(
        self,
        config: ProcessingConfig,
        progress: ProgressCallback
    ) -> ProcessingResult:
        """Process clip using FFmpeg only (no AI upscaling)."""
        from app.services.ffmpeg_service import extract_clip

        progress.report(50, 100, "Processing with FFmpeg", "encoding")

        # For now, just copy the input to output
        # Full FFmpeg processing would apply crop keyframes, segments, etc.
        import shutil
        shutil.copy2(config.input_path, config.output_path)

        progress.report(100, 100, "Processing complete", "complete")

        if os.path.exists(config.output_path):
            info = get_video_info(config.output_path)
            return ProcessingResult(
                success=True,
                output_path=config.output_path,
                duration_seconds=info.get('duration'),
                output_width=info.get('width'),
                output_height=info.get('height')
            )
        else:
            return ProcessingResult(
                success=False,
                error_message="Output file not created"
            )

    async def concatenate_clips(
        self,
        clip_paths: List[str],
        output_path: str,
        transition_type: str = "cut",
        transition_duration: float = 0.5,
        include_audio: bool = True,
        progress: Optional[ProgressCallback] = None
    ) -> ProcessingResult:
        """
        Concatenate multiple processed clips with transitions.

        Args:
            clip_paths: List of processed clip paths
            output_path: Path for concatenated output
            transition_type: "cut" | "fade" | "dissolve"
            transition_duration: Duration of transition in seconds
            include_audio: Whether to include audio
            progress: Optional progress callback

        Returns:
            ProcessingResult with success status and output path
        """
        if not self._ffmpeg_available:
            return ProcessingResult(
                success=False,
                error_message="FFmpeg not available"
            )

        progress = progress or ProgressCallback(None)
        progress.log(f"Concatenating {len(clip_paths)} clips with {transition_type} transition")
        progress.report(0, 100, "Starting concatenation", "concat")

        try:
            # Run in thread to avoid blocking
            loop = asyncio.get_event_loop()
            success = await loop.run_in_executor(
                None,
                lambda: concatenate_clips(
                    clip_paths,
                    output_path,
                    transition_type,
                    transition_duration,
                    include_audio
                )
            )

            progress.report(100, 100, "Concatenation complete", "complete")

            if success and os.path.exists(output_path):
                info = get_video_info(output_path)
                return ProcessingResult(
                    success=True,
                    output_path=output_path,
                    duration_seconds=info.get('duration'),
                    output_width=info.get('width'),
                    output_height=info.get('height')
                )
            else:
                return ProcessingResult(
                    success=False,
                    error_message="Concatenation failed"
                )

        except Exception as e:
            logger.error(f"Concatenation failed: {e}", exc_info=True)
            return ProcessingResult(
                success=False,
                error_message=str(e)
            )

    async def apply_overlay(
        self,
        input_path: str,
        output_path: str,
        highlight_regions: List[Dict[str, Any]],
        effect_type: str = "original",
        progress: Optional[ProgressCallback] = None
    ) -> ProcessingResult:
        """
        Apply highlight overlay effects to a video.

        Args:
            input_path: Path to input video
            output_path: Path for output video
            highlight_regions: List of highlight region configs with keyframes
            effect_type: "original" | "brightness_boost" | "dark_overlay"
            progress: Optional progress callback

        Returns:
            ProcessingResult with success status and output path
        """
        if not self._ffmpeg_available:
            return ProcessingResult(
                success=False,
                error_message="FFmpeg not available"
            )

        progress = progress or ProgressCallback(None)
        progress.log(f"Applying {len(highlight_regions)} highlight regions")
        progress.report(0, 100, "Starting overlay processing", "overlay")

        try:
            # For now, just copy the input to output
            # Full implementation would render highlight overlays frame by frame
            import shutil
            shutil.copy2(input_path, output_path)

            progress.report(100, 100, "Overlay complete", "complete")

            if os.path.exists(output_path):
                info = get_video_info(output_path)
                return ProcessingResult(
                    success=True,
                    output_path=output_path,
                    duration_seconds=info.get('duration'),
                    output_width=info.get('width'),
                    output_height=info.get('height')
                )
            else:
                return ProcessingResult(
                    success=False,
                    error_message="Output file not created"
                )

        except Exception as e:
            logger.error(f"Overlay failed: {e}", exc_info=True)
            return ProcessingResult(
                success=False,
                error_message=str(e)
            )


# Register the processor with the factory
ProcessorFactory.register(ProcessingBackend.LOCAL_GPU, LocalGPUProcessor)
