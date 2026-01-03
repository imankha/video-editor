"""
Base class for video transition strategies.

This module defines the abstract interface that all transition types must implement.
Each transition type (cut, fade, dissolve) provides a different way to combine clips.
"""

from abc import ABC, abstractmethod
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)


class TransitionStrategy(ABC):
    """
    Abstract base class for video transitions.

    Implementations handle the FFmpeg filter construction and execution
    for different transition types.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the transition type name (e.g., 'cut', 'fade', 'dissolve')."""
        pass

    @abstractmethod
    def concatenate(
        self,
        clip_paths: List[str],
        output_path: str,
        duration: float,
        include_audio: bool = True
    ) -> bool:
        """
        Concatenate clips with this transition type.

        Args:
            clip_paths: List of input video file paths
            output_path: Path for the concatenated output
            duration: Duration of the transition in seconds
            include_audio: Whether to include audio in output

        Returns:
            True if successful, False otherwise
        """
        pass


class TransitionFactory:
    """
    Factory for creating transition strategy instances.

    Usage:
        strategy = TransitionFactory.create('fade')
        strategy.concatenate(clips, output, duration=0.5)
    """

    _registry: dict = {}

    @classmethod
    def register(cls, name: str, strategy_class: type):
        """Register a transition strategy class."""
        cls._registry[name.lower()] = strategy_class
        logger.debug(f"Registered transition strategy: {name}")

    @classmethod
    def create(cls, transition_type: str) -> TransitionStrategy:
        """
        Create a transition strategy instance.

        Args:
            transition_type: 'cut', 'fade', or 'dissolve'

        Returns:
            TransitionStrategy instance

        Raises:
            ValueError: If transition type is not registered
        """
        strategy_class = cls._registry.get(transition_type.lower())
        if strategy_class is None:
            available = list(cls._registry.keys())
            raise ValueError(
                f"Unknown transition type: {transition_type}. "
                f"Available: {available}"
            )
        return strategy_class()

    @classmethod
    def get_available(cls) -> List[str]:
        """Return list of registered transition types."""
        return list(cls._registry.keys())
