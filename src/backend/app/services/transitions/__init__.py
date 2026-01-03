"""
Transition strategies for video concatenation.

This package provides different transition effects for combining multiple
video clips. Uses the Strategy pattern for extensibility.

Available transitions:
- cut: Simple concatenation (no transition effect)
- fade: Fade to black between clips
- dissolve: Cross-dissolve between clips

Usage:
    from app.services.transitions import TransitionFactory

    # Create a strategy and apply it
    strategy = TransitionFactory.create('dissolve')
    success = strategy.concatenate(
        clip_paths=['clip1.mp4', 'clip2.mp4'],
        output_path='output.mp4',
        duration=0.5,
        include_audio=True
    )

    # Or use the convenience function
    from app.services.transitions import apply_transition

    success = apply_transition(
        transition_type='fade',
        clip_paths=['clip1.mp4', 'clip2.mp4'],
        output_path='output.mp4',
        duration=0.5
    )
"""

from .base import TransitionStrategy, TransitionFactory

# Import implementations to register them with the factory
from . import cut  # noqa: F401
from . import fade  # noqa: F401
from . import dissolve  # noqa: F401

from .cut import CutTransition
from .fade import FadeTransition
from .dissolve import DissolveTransition

import logging
from typing import List

logger = logging.getLogger(__name__)


def apply_transition(
    transition_type: str,
    clip_paths: List[str],
    output_path: str,
    duration: float = 0.5,
    include_audio: bool = True
) -> bool:
    """
    Apply a transition to concatenate clips.

    This is a convenience function that creates the appropriate
    strategy and applies it.

    Args:
        transition_type: 'cut', 'fade', or 'dissolve'
        clip_paths: List of input video file paths
        output_path: Path for the concatenated output
        duration: Duration of transition in seconds (ignored for 'cut')
        include_audio: Whether to include audio in output

    Returns:
        True if successful, False otherwise
    """
    try:
        strategy = TransitionFactory.create(transition_type)
        return strategy.concatenate(
            clip_paths=clip_paths,
            output_path=output_path,
            duration=duration,
            include_audio=include_audio
        )
    except ValueError as e:
        logger.error(f"Invalid transition type: {e}")
        # Fall back to cut transition
        logger.warning(f"Falling back to 'cut' transition")
        strategy = TransitionFactory.create('cut')
        return strategy.concatenate(
            clip_paths=clip_paths,
            output_path=output_path,
            duration=duration,
            include_audio=include_audio
        )


__all__ = [
    # Base classes
    'TransitionStrategy',
    'TransitionFactory',
    # Implementations
    'CutTransition',
    'FadeTransition',
    'DissolveTransition',
    # Convenience function
    'apply_transition',
]
