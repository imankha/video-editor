"""
Video Processing Interface and Implementations.

This module defines the interface for GPU-intensive video processing operations,
allowing for multiple backend implementations:
- LocalGPUProcessor: Uses local GPU (Real-ESRGAN, RIFE)
- WebGPUProcessor: Future - uses browser WebGPU
- RunPodProcessor: Future - uses RunPod cloud GPUs

The interface design allows the export system to be agnostic to where
processing happens, enabling easy migration between processing backends.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Callable
from enum import Enum
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class ProcessingBackend(Enum):
    """Available processing backends."""
    LOCAL_GPU = "local_gpu"
    MODAL = "modal"      # Modal.com cloud GPUs
    WEB_GPU = "web_gpu"  # Future
    RUNPOD = "runpod"    # Future (deprecated - use Modal)
    CPU_ONLY = "cpu"     # Fallback


@dataclass
class ProcessingConfig:
    """Configuration for video processing operations."""
    # Input/Output
    input_path: str
    output_path: str

    # Resolution
    target_width: Optional[int] = None
    target_height: Optional[int] = None

    # Crop keyframes (list of {time, x, y, width, height})
    crop_keyframes: Optional[List[Dict[str, Any]]] = None

    # Segments with speed changes
    segment_data: Optional[Dict[str, Any]] = None

    # Quality settings
    export_mode: str = "quality"  # "quality" | "speed"
    target_fps: int = 30
    include_audio: bool = True

    # AI Upscaling
    upscale_factor: int = 4
    use_ai_upscale: bool = True


@dataclass
class ProcessingResult:
    """Result of a video processing operation."""
    success: bool
    output_path: Optional[str] = None
    error_message: Optional[str] = None
    duration_seconds: Optional[float] = None
    output_width: Optional[int] = None
    output_height: Optional[int] = None


class ProgressCallback:
    """Callback interface for progress reporting."""

    def __init__(self, callback: Optional[Callable[[int, int, str, str], None]] = None):
        """
        Initialize progress callback.

        Args:
            callback: Function(current, total, message, phase) to call on progress
        """
        self._callback = callback

    def report(self, current: int, total: int, message: str, phase: str = "processing"):
        """Report progress to registered callback."""
        if self._callback:
            self._callback(current, total, message, phase)

    def log(self, message: str):
        """Log a message (always logged, optionally reported)."""
        logger.info(f"[VideoProcessor] {message}")


class VideoProcessor(ABC):
    """
    Abstract interface for video processing operations.

    This interface defines GPU-intensive operations that may run on different
    backends (local GPU, WebGPU, RunPod). Implementations must handle:
    - AI upscaling (Real-ESRGAN or equivalent)
    - Frame interpolation (RIFE or equivalent)
    - Crop keyframe application
    - Segment speed changes
    """

    @property
    @abstractmethod
    def backend(self) -> ProcessingBackend:
        """Return the processing backend type."""
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Check if this processor is available and ready to use."""
        pass

    @abstractmethod
    async def process_clip(
        self,
        config: ProcessingConfig,
        progress: Optional[ProgressCallback] = None
    ) -> ProcessingResult:
        """
        Process a single video clip with the given configuration.

        This is the main entry point for video processing. It handles:
        1. Applying crop keyframes (animated crop)
        2. Applying segment speed changes
        3. AI upscaling (if enabled)
        4. Encoding to final output

        Args:
            config: Processing configuration
            progress: Optional progress callback

        Returns:
            ProcessingResult with success status and output path
        """
        pass

    @abstractmethod
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
        pass

    @abstractmethod
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
        pass


class ProcessorFactory:
    """Factory for creating video processors."""

    _processors: Dict[ProcessingBackend, type] = {}

    @classmethod
    def register(cls, backend: ProcessingBackend, processor_class: type):
        """Register a processor implementation for a backend."""
        cls._processors[backend] = processor_class

    @classmethod
    def create(cls, backend: ProcessingBackend = ProcessingBackend.LOCAL_GPU) -> VideoProcessor:
        """
        Create a video processor for the specified backend.

        Falls back to CPU_ONLY if requested backend is unavailable.
        """
        if backend in cls._processors:
            processor = cls._processors[backend]()
            if processor.is_available():
                return processor
            logger.warning(f"Processor {backend} not available, falling back")

        # Fallback chain
        for fallback_backend in [ProcessingBackend.LOCAL_GPU, ProcessingBackend.CPU_ONLY]:
            if fallback_backend in cls._processors:
                processor = cls._processors[fallback_backend]()
                if processor.is_available():
                    logger.info(f"Using fallback processor: {fallback_backend}")
                    return processor

        raise RuntimeError("No video processor available")

    @classmethod
    def get_available_backends(cls) -> List[ProcessingBackend]:
        """Get list of available processing backends."""
        available = []
        for backend, processor_class in cls._processors.items():
            try:
                processor = processor_class()
                if processor.is_available():
                    available.append(backend)
            except Exception:
                pass
        return available
