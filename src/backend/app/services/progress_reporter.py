"""
Progress Reporter - Centralized progress tracking for export operations.

This module provides a clean abstraction for progress reporting, replacing
ad-hoc nested callbacks with a structured approach.

USAGE:
    from app.services.progress_reporter import ProgressReporter, ProgressPhase

    # Create reporter with callback
    def on_progress(percent, message, phase):
        await websocket.send_json({"type": "progress", "percent": percent})

    reporter = ProgressReporter(callback=on_progress)

    # Report progress in different phases
    reporter.set_phase(ProgressPhase.CROPPING, weight=0.2)
    for i, frame in enumerate(frames):
        process(frame)
        reporter.update(i + 1, total_frames, "Cropping frames")

    reporter.set_phase(ProgressPhase.UPSCALING, weight=0.6)
    for i, frame in enumerate(frames):
        upscale(frame)
        reporter.update(i + 1, total_frames, "Upscaling frames")

    reporter.set_phase(ProgressPhase.ENCODING, weight=0.2)
    # ... encoding
"""

import logging
from enum import Enum
from typing import Callable, Optional, Dict, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


class ProgressPhase(Enum):
    """Export progress phases."""
    INITIALIZING = "initializing"
    CROPPING = "cropping"
    UPSCALING = "ai_upscale"
    ENCODING = "encoding"
    INTERPOLATION = "rife_interpolation"
    CACHED = "cached"
    FINALIZING = "finalizing"


# Default phase weights (how much of total progress each phase represents)
DEFAULT_PHASE_WEIGHTS = {
    ProgressPhase.INITIALIZING: 0.05,
    ProgressPhase.CROPPING: 0.15,
    ProgressPhase.UPSCALING: 0.50,
    ProgressPhase.ENCODING: 0.20,
    ProgressPhase.INTERPOLATION: 0.10,
    ProgressPhase.FINALIZING: 0.05,
    ProgressPhase.CACHED: 0.0,  # Cached skips all work
}


@dataclass
class ProgressState:
    """Current progress state."""
    phase: ProgressPhase = ProgressPhase.INITIALIZING
    current: int = 0
    total: int = 100
    message: str = ""
    overall_percent: float = 0.0


class ProgressReporter:
    """
    Centralized progress reporter for export operations.

    Handles the complexity of multi-phase progress tracking with weighted phases.
    Each phase can have different weights contributing to overall progress.

    Example:
        reporter = ProgressReporter(callback=my_callback)
        reporter.set_phase(ProgressPhase.CROPPING, weight=0.2)
        for i in range(100):
            reporter.update(i + 1, 100, "Processing frame")
        # Overall progress: 0% -> 20%

        reporter.set_phase(ProgressPhase.UPSCALING, weight=0.6)
        for i in range(100):
            reporter.update(i + 1, 100, "Upscaling")
        # Overall progress: 20% -> 80%
    """

    def __init__(
        self,
        callback: Optional[Callable[[int, int, str, str], None]] = None,
        phase_weights: Optional[Dict[ProgressPhase, float]] = None,
        throttle_ms: int = 100
    ):
        """
        Initialize progress reporter.

        Args:
            callback: Optional callback(current, total, message, phase_name)
                     This matches the existing callback signature for compatibility
            phase_weights: Custom phase weights (defaults to DEFAULT_PHASE_WEIGHTS)
            throttle_ms: Minimum time between callback invocations (not implemented yet)
        """
        self._callback = callback
        self._phase_weights = phase_weights or DEFAULT_PHASE_WEIGHTS.copy()
        self._throttle_ms = throttle_ms

        # State
        self._current_phase = ProgressPhase.INITIALIZING
        self._phase_start_percent = 0.0
        self._phase_weight = 0.05
        self._completed_phases_percent = 0.0

        # For phase ordering
        self._phase_order: list[ProgressPhase] = []

    def set_phase(
        self,
        phase: ProgressPhase,
        weight: Optional[float] = None,
        message: Optional[str] = None
    ) -> None:
        """
        Start a new progress phase.

        Args:
            phase: The phase to start
            weight: Weight of this phase (0.0-1.0), or use default
            message: Optional message to report
        """
        # Mark previous phase complete
        if self._current_phase != phase:
            self._completed_phases_percent += self._phase_weight

        self._current_phase = phase
        self._phase_weight = weight if weight is not None else self._phase_weights.get(phase, 0.1)
        self._phase_start_percent = self._completed_phases_percent
        self._phase_order.append(phase)

        if message and self._callback:
            self._callback(0, 100, message, phase.value)

    def update(
        self,
        current: int,
        total: int,
        message: str = "",
        phase: Optional[ProgressPhase] = None
    ) -> None:
        """
        Update progress within the current phase.

        Args:
            current: Current item number (1-based typically)
            total: Total items in this phase
            message: Progress message
            phase: Optional phase override (for backward compatibility)
        """
        if phase is not None and phase != self._current_phase:
            self.set_phase(phase)

        # Calculate overall percent
        if total > 0:
            phase_progress = current / total
        else:
            phase_progress = 1.0

        overall_percent = self._phase_start_percent + (self._phase_weight * phase_progress)
        overall_percent = min(1.0, overall_percent)  # Cap at 100%

        if self._callback:
            # Call with the existing signature for compatibility
            self._callback(current, total, message, self._current_phase.value)

    def complete(self, message: str = "Complete") -> None:
        """Mark export as complete."""
        if self._callback:
            self._callback(100, 100, message, "complete")

    def fail(self, message: str = "Failed") -> None:
        """Mark export as failed."""
        if self._callback:
            self._callback(0, 100, message, "error")

    def create_sub_reporter(
        self,
        phase: ProgressPhase,
        weight: float
    ) -> 'ProgressReporter':
        """
        Create a child reporter for a sub-operation.

        This is useful when you need to pass a reporter to a sub-function
        that should only report progress within a portion of the overall progress.

        Args:
            phase: Phase for the sub-operation
            weight: Weight of this sub-operation within the parent's current phase

        Returns:
            A new ProgressReporter that maps to a portion of the parent's progress
        """
        def sub_callback(current, total, message, phase_name):
            # Map sub-progress to parent progress
            if total > 0:
                sub_percent = current / total
            else:
                sub_percent = 1.0

            # Calculate contribution to parent
            contribution = self._phase_weight * weight * sub_percent
            parent_current = int((self._phase_start_percent + contribution) * 100)
            self._callback(parent_current, 100, message, phase_name)

        return ProgressReporter(callback=sub_callback)

    def as_callback(self) -> Callable[[int, int, str, str], None]:
        """
        Get a callback function for backward compatibility.

        Returns:
            A callback function matching the legacy signature
        """
        def callback(current: int, total: int, message: str, phase: str = 'ai_upscale'):
            # Map legacy phase string to enum
            phase_map = {
                'ai_upscale': ProgressPhase.UPSCALING,
                'cropping': ProgressPhase.CROPPING,
                'encoding': ProgressPhase.ENCODING,
                'rife_interpolation': ProgressPhase.INTERPOLATION,
                'cached': ProgressPhase.CACHED,
            }
            phase_enum = phase_map.get(phase, ProgressPhase.UPSCALING)
            self.update(current, total, message, phase_enum)

        return callback

    @classmethod
    def from_callback(
        cls,
        callback: Optional[Callable[[int, int, str, str], None]]
    ) -> 'ProgressReporter':
        """
        Create a ProgressReporter from a legacy callback.

        This allows gradual migration - wrap existing callbacks in a reporter.

        Args:
            callback: Legacy callback(current, total, message, phase)

        Returns:
            ProgressReporter that wraps the callback
        """
        return cls(callback=callback)


def create_clip_progress_reporter(
    clip_index: int,
    total_clips: int,
    base_callback: Optional[Callable[[int, int, str, str], None]] = None,
    clip_weight: float = 0.7
) -> ProgressReporter:
    """
    Create a progress reporter for processing one clip in a multi-clip export.

    This replaces the pattern of creating nested callback factories.

    Args:
        clip_index: Current clip index (0-based)
        total_clips: Total number of clips
        base_callback: The parent progress callback
        clip_weight: How much of total progress clips represent (default 70%)

    Returns:
        ProgressReporter configured for this clip's portion of overall progress

    Example:
        for i, clip in enumerate(clips):
            reporter = create_clip_progress_reporter(i, len(clips), progress_callback)
            process_clip(clip, progress_callback=reporter.as_callback())
    """
    if base_callback is None:
        return ProgressReporter()

    # Calculate this clip's progress range
    # First 10% = initialization
    # Next 70% = clip processing (divided among clips)
    # Last 20% = finalization
    init_percent = 10
    clip_start = init_percent + int((clip_index / total_clips) * int(clip_weight * 100))
    clip_end = init_percent + int(((clip_index + 1) / total_clips) * int(clip_weight * 100))

    def clip_callback(current, total, message, phase):
        if total > 0:
            phase_progress = current / total
        else:
            phase_progress = 1.0

        overall_percent = clip_start + int((clip_end - clip_start) * phase_progress)
        base_callback(overall_percent, 100, f"Clip {clip_index + 1}/{total_clips}: {message}", phase)

    return ProgressReporter(callback=clip_callback)
