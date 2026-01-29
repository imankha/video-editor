"""
Local GPU Video Processor Implementation.

This module implements the VideoProcessor interface using local CUDA GPUs.
Uses the existing AI upscaler (Real-ESRGAN) and FFmpeg processing.

Usage:
    from .video_processor import ProcessorFactory, ProcessingBackend
    from .processor_local import LocalGPUProcessor

    # Register the processor (auto-registered on import)
    processor = ProcessorFactory.create(ProcessingBackend.LOCAL_GPU)
    result = await processor.apply_overlay(...)
"""

import asyncio
import logging
import os
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional

from .video_processor import (
    VideoProcessor,
    ProcessingBackend,
    ProcessingConfig,
    ProcessingResult,
    ProgressCallback,
)

logger = logging.getLogger(__name__)


class LocalGPUProcessor(VideoProcessor):
    """
    Video processor using local CUDA GPUs.

    This processor:
    - Works with local file paths
    - Uses AI upscaler (Real-ESRGAN) for quality upscaling
    - Uses FFmpeg for encoding
    - Supports frame-by-frame overlay rendering
    """

    def __init__(self):
        self._cuda_available = None

    @property
    def backend(self) -> ProcessingBackend:
        return ProcessingBackend.LOCAL_GPU

    def is_available(self) -> bool:
        """Check if CUDA is available for local GPU processing."""
        if self._cuda_available is None:
            try:
                import torch
                self._cuda_available = torch.cuda.is_available()
            except ImportError:
                self._cuda_available = False
        return self._cuda_available

    async def process_clip(
        self,
        config: ProcessingConfig,
        progress: Optional[ProgressCallback] = None
    ) -> ProcessingResult:
        """
        Process a video clip using local CUDA GPU.

        Uses the AI upscaler for high-quality upscaling with Real-ESRGAN.
        """
        if not self.is_available():
            return ProcessingResult(
                success=False,
                error_message="CUDA not available"
            )

        try:
            # Import the AI upscaler
            from ..ai_upscaler import AIVideoUpscaler

            upscaler = AIVideoUpscaler(
                device='cuda',
                export_mode=config.export_mode,
                sr_model_name='realesr_general_x4v3'
            )

            if upscaler.upsampler is None:
                return ProcessingResult(
                    success=False,
                    error_message="Failed to load AI upscaler model"
                )

            # Create progress callback wrapper
            def progress_callback(current, total, message, phase):
                if progress:
                    progress.report(current, total, message, phase)

            # Convert keyframes to dict format
            keyframes_dict = []
            if config.crop_keyframes:
                keyframes_dict = [
                    {
                        'time': kf.get('time', 0),
                        'x': kf.get('x', 0),
                        'y': kf.get('y', 0),
                        'width': kf.get('width', 1920),
                        'height': kf.get('height', 1080),
                    }
                    for kf in config.crop_keyframes
                ]

            # Run upscaling in thread pool
            result = await asyncio.to_thread(
                upscaler.process_video_with_upscale,
                input_path=config.input_path,
                output_path=config.output_path,
                keyframes=keyframes_dict,
                target_fps=config.target_fps,
                export_mode=config.export_mode,
                progress_callback=progress_callback,
                segment_data=config.segment_data,
                include_audio=config.include_audio,
            )

            return ProcessingResult(
                success=True,
                output_path=config.output_path,
                output_width=config.target_width,
                output_height=config.target_height,
            )

        except Exception as e:
            logger.error(f"Local GPU processing failed: {e}", exc_info=True)
            return ProcessingResult(
                success=False,
                error_message=str(e)
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
        Concatenate clips using FFmpeg.
        """
        import subprocess

        if not clip_paths:
            return ProcessingResult(
                success=False,
                error_message="No clips to concatenate"
            )

        try:
            # Create concat file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
                for path in clip_paths:
                    f.write(f"file '{path}'\n")
                concat_file = f.name

            cmd = [
                'ffmpeg', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', concat_file,
                '-c', 'copy' if include_audio else '-an',
                output_path
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)

            os.unlink(concat_file)

            if result.returncode != 0:
                return ProcessingResult(
                    success=False,
                    error_message=f"FFmpeg concat failed: {result.stderr[:500]}"
                )

            return ProcessingResult(
                success=True,
                output_path=output_path
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
        effect_type: str = "dark_overlay",
        progress: Optional[ProgressCallback] = None
    ) -> ProcessingResult:
        """
        Apply highlight overlay using local processing.

        Uses frame-by-frame rendering with OpenCV, piped to FFmpeg.
        """
        import cv2
        import subprocess
        import numpy as np

        try:
            # If no highlights, just copy
            if not highlight_regions:
                import shutil
                shutil.copy(input_path, output_path)
                return ProcessingResult(success=True, output_path=output_path)

            cap = cv2.VideoCapture(input_path)
            if not cap.isOpened():
                return ProcessingResult(
                    success=False,
                    error_message=f"Could not open video: {input_path}"
                )

            fps = cap.get(cv2.CAP_PROP_FPS)
            frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            # Import highlight rendering
            from ..ai_upscaler.keyframe_interpolator import KeyframeInterpolator

            # Start FFmpeg process
            ffmpeg_cmd = [
                'ffmpeg', '-y',
                '-f', 'rawvideo',
                '-pix_fmt', 'bgr24',
                '-s', f'{width}x{height}',
                '-r', str(fps),
                '-i', 'pipe:0',
                '-i', input_path,
                '-map', '0:v',
                '-map', '1:a?',
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-crf', '23',
                '-c:a', 'aac',
                '-shortest',
                output_path,
            ]

            ffmpeg_proc = subprocess.Popen(
                ffmpeg_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )

            sorted_regions = sorted(highlight_regions, key=lambda r: r["start_time"])

            frame_idx = 0
            try:
                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break

                    current_time = frame_idx / fps

                    # Find active region
                    active_region = None
                    for region in sorted_regions:
                        if region["start_time"] <= current_time <= region["end_time"]:
                            active_region = region
                            break

                    # Render highlight
                    if active_region:
                        highlight = KeyframeInterpolator.interpolate_highlight(
                            active_region['keyframes'], current_time
                        )
                        if highlight is not None:
                            frame = KeyframeInterpolator.render_highlight_on_frame(
                                frame, highlight, (width, height), None, effect_type
                            )

                    ffmpeg_proc.stdin.write(frame.tobytes())
                    frame_idx += 1

                    if progress and frame_idx % 30 == 0:
                        pct = int((frame_idx / frame_count) * 100)
                        progress.report(pct, 100, f"Processing frame {frame_idx}/{frame_count}", "render")

            finally:
                cap.release()
                if ffmpeg_proc.stdin:
                    ffmpeg_proc.stdin.close()

            stdout, stderr = ffmpeg_proc.communicate()

            if ffmpeg_proc.returncode != 0:
                return ProcessingResult(
                    success=False,
                    error_message=f"FFmpeg encoding failed: {stderr.decode()[:500]}"
                )

            return ProcessingResult(
                success=True,
                output_path=output_path,
                output_width=width,
                output_height=height,
            )

        except Exception as e:
            logger.error(f"Local overlay processing failed: {e}", exc_info=True)
            return ProcessingResult(
                success=False,
                error_message=str(e)
            )


# Auto-register with factory when imported
def _register():
    from .video_processor import ProcessorFactory, ProcessingBackend
    ProcessorFactory.register(ProcessingBackend.LOCAL_GPU, LocalGPUProcessor)


_register()
