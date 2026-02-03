"""
Modal GPU Video Processor Implementation.

This module implements the VideoProcessor interface using Modal's cloud GPUs.
Videos are stored in R2, and Modal handles download/process/upload.

Usage:
    from .video_processor import ProcessorFactory, ProcessingBackend
    from .processor_modal import ModalProcessor

    # Register the processor
    ProcessorFactory.register(ProcessingBackend.MODAL, ModalProcessor)

    # Use via factory
    processor = ProcessorFactory.create(ProcessingBackend.MODAL)
    result = await processor.apply_overlay(...)
"""

import logging
import os
from typing import List, Dict, Any, Optional

from .video_processor import (
    VideoProcessor,
    ProcessingBackend,
    ProcessingConfig,
    ProcessingResult,
    ProgressCallback,
)
from .modal_client import modal_enabled, call_modal_overlay

logger = logging.getLogger(__name__)


class ModalProcessor(VideoProcessor):
    """
    Video processor using Modal.com cloud GPUs.

    This processor:
    - Expects videos to be in R2 storage
    - Calls Modal functions remotely
    - Modal handles download from R2 -> process -> upload to R2
    - Returns R2 keys for processed videos
    """

    @property
    def backend(self) -> ProcessingBackend:
        return ProcessingBackend.MODAL

    def is_available(self) -> bool:
        """Check if Modal is enabled and credentials are configured."""
        return modal_enabled()

    async def process_clip(
        self,
        config: ProcessingConfig,
        progress: Optional[ProgressCallback] = None
    ) -> ProcessingResult:
        """
        Process a video clip using Modal GPU.

        Note: Framing always uses AI upscaling via process_framing_ai.
        This method is not used - framing goes through the framing router directly.
        """
        return ProcessingResult(
            success=False,
            error_message="Framing via ModalProcessor not implemented - use framing router with AI upscaling"
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
        Concatenate clips using Modal.

        Note: Not yet implemented - falls back to local processing.
        """
        return ProcessingResult(
            success=False,
            error_message="Concatenation not yet implemented for Modal"
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
        Apply highlight overlay using Modal GPU.

        Args:
            input_path: R2 key for input video (format: "{user_id}/{relative_path}")
            output_path: R2 key for output video
            highlight_regions: Highlight regions with keyframes
            effect_type: Effect type for highlights
            progress: Optional progress callback
        """
        if not self.is_available():
            return ProcessingResult(
                success=False,
                error_message="Modal is not available"
            )

        # Extract user_id from path
        parts = input_path.split("/", 1)
        if len(parts) != 2:
            return ProcessingResult(
                success=False,
                error_message=f"Invalid R2 path format: {input_path}"
            )

        user_id = parts[0]
        input_key = parts[1]

        output_parts = output_path.split("/", 1)
        output_key = output_parts[1] if len(output_parts) == 2 else output_path

        # Generate job ID
        import uuid
        job_id = f"overlay-{uuid.uuid4().hex[:8]}"

        if progress:
            progress.report(0, 100, "Sending to Modal GPU...", "upload")

        try:
            result = await call_modal_overlay(
                job_id=job_id,
                user_id=user_id,
                input_key=input_key,
                output_key=output_key,
                highlight_regions=highlight_regions,
                effect_type=effect_type,
            )

            if result.get("status") == "success":
                if progress:
                    progress.report(100, 100, "Modal processing complete", "complete")
                return ProcessingResult(
                    success=True,
                    output_path=f"{user_id}/{output_key}",
                )
            else:
                return ProcessingResult(
                    success=False,
                    error_message=result.get("error", "Unknown Modal error")
                )

        except Exception as e:
            logger.error(f"Modal overlay processing failed: {e}", exc_info=True)
            return ProcessingResult(
                success=False,
                error_message=str(e)
            )


# Auto-register with factory when imported
def _register():
    from .video_processor import ProcessorFactory, ProcessingBackend
    ProcessorFactory.register(ProcessingBackend.MODAL, ModalProcessor)


_register()
