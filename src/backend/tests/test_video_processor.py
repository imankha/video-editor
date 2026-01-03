"""
Tests for video processor interface.

These tests verify:
1. Interface contracts are correct
2. Factory creates appropriate processors
3. Configuration dataclasses work correctly
"""

import pytest
from app.services.video_processor import (
    ProcessingBackend,
    ProcessingConfig,
    ProcessingResult,
    ProgressCallback,
    VideoProcessor,
    ProcessorFactory,
)


class TestProcessingConfig:
    """Test ProcessingConfig dataclass."""

    def test_default_values(self):
        """ProcessingConfig should have sensible defaults."""
        config = ProcessingConfig(
            input_path="/tmp/input.mp4",
            output_path="/tmp/output.mp4"
        )
        assert config.input_path == "/tmp/input.mp4"
        assert config.output_path == "/tmp/output.mp4"
        assert config.target_width is None
        assert config.target_height is None
        assert config.crop_keyframes is None
        assert config.segment_data is None
        assert config.export_mode == "quality"
        assert config.target_fps == 30
        assert config.include_audio is True
        assert config.upscale_factor == 4
        assert config.use_ai_upscale is True

    def test_custom_values(self):
        """ProcessingConfig should accept custom values."""
        config = ProcessingConfig(
            input_path="/in.mp4",
            output_path="/out.mp4",
            target_width=1920,
            target_height=1080,
            crop_keyframes=[{"time": 0, "x": 0, "y": 0, "width": 100, "height": 100}],
            segment_data={"trim_start": 0, "trim_end": 10},
            export_mode="speed",
            target_fps=60,
            include_audio=False,
            upscale_factor=2,
            use_ai_upscale=False
        )
        assert config.target_width == 1920
        assert config.target_height == 1080
        assert len(config.crop_keyframes) == 1
        assert config.segment_data["trim_start"] == 0
        assert config.export_mode == "speed"
        assert config.target_fps == 60
        assert config.include_audio is False
        assert config.upscale_factor == 2
        assert config.use_ai_upscale is False


class TestProcessingResult:
    """Test ProcessingResult dataclass."""

    def test_success_result(self):
        """ProcessingResult should represent success."""
        result = ProcessingResult(
            success=True,
            output_path="/tmp/output.mp4",
            duration_seconds=10.5,
            output_width=1920,
            output_height=1080
        )
        assert result.success is True
        assert result.output_path == "/tmp/output.mp4"
        assert result.error_message is None

    def test_failure_result(self):
        """ProcessingResult should represent failure."""
        result = ProcessingResult(
            success=False,
            error_message="FFmpeg failed: codec not found"
        )
        assert result.success is False
        assert result.output_path is None
        assert result.error_message == "FFmpeg failed: codec not found"


class TestProgressCallback:
    """Test ProgressCallback interface."""

    def test_callback_invoked(self):
        """Progress callback should invoke registered function."""
        calls = []

        def record_call(current, total, message, phase):
            calls.append((current, total, message, phase))

        progress = ProgressCallback(record_call)
        progress.report(1, 10, "Processing frame 1", "encoding")

        assert len(calls) == 1
        assert calls[0] == (1, 10, "Processing frame 1", "encoding")

    def test_callback_none_safe(self):
        """Progress callback should handle None callback gracefully."""
        progress = ProgressCallback(None)
        # Should not raise
        progress.report(1, 10, "Test", "test")

    def test_default_phase(self):
        """Progress callback should use default phase."""
        calls = []

        def record_call(current, total, message, phase):
            calls.append(phase)

        progress = ProgressCallback(record_call)
        progress.report(1, 10, "Test")

        assert calls[0] == "processing"


class TestProcessingBackend:
    """Test ProcessingBackend enum."""

    def test_backend_values(self):
        """ProcessingBackend should have expected values."""
        assert ProcessingBackend.LOCAL_GPU.value == "local_gpu"
        assert ProcessingBackend.WEB_GPU.value == "web_gpu"
        assert ProcessingBackend.RUNPOD.value == "runpod"
        assert ProcessingBackend.CPU_ONLY.value == "cpu"

    def test_all_backends_defined(self):
        """All expected backends should be defined."""
        backends = list(ProcessingBackend)
        assert len(backends) >= 4  # At least 4 backends


class TestProcessorFactory:
    """Test ProcessorFactory."""

    def test_get_available_backends_returns_list(self):
        """get_available_backends should return a list."""
        backends = ProcessorFactory.get_available_backends()
        assert isinstance(backends, list)

    def test_factory_register_and_create(self):
        """Factory should register and create processors."""
        # Create a mock processor for testing
        class MockProcessor(VideoProcessor):
            @property
            def backend(self):
                return ProcessingBackend.CPU_ONLY

            def is_available(self):
                return True

            async def process_clip(self, config, progress=None):
                return ProcessingResult(success=True)

            async def concatenate_clips(self, paths, output, **kwargs):
                return ProcessingResult(success=True)

            async def apply_overlay(self, input_path, output_path, regions, **kwargs):
                return ProcessingResult(success=True)

        # Register and create
        ProcessorFactory.register(ProcessingBackend.CPU_ONLY, MockProcessor)
        processor = ProcessorFactory.create(ProcessingBackend.CPU_ONLY)

        assert processor is not None
        assert processor.backend == ProcessingBackend.CPU_ONLY
        assert processor.is_available()


class TestVideoProcessorInterface:
    """Test that VideoProcessor interface is properly defined."""

    def test_interface_is_abstract(self):
        """VideoProcessor should be abstract and not instantiable."""
        with pytest.raises(TypeError):
            VideoProcessor()

    def test_interface_requires_backend_property(self):
        """VideoProcessor subclass must implement backend property."""
        class IncompleteProcessor(VideoProcessor):
            def is_available(self):
                return True

            async def process_clip(self, config, progress=None):
                pass

            async def concatenate_clips(self, *args, **kwargs):
                pass

            async def apply_overlay(self, *args, **kwargs):
                pass

        with pytest.raises(TypeError):
            IncompleteProcessor()

    def test_interface_requires_all_methods(self):
        """VideoProcessor subclass must implement all abstract methods."""
        class PartialProcessor(VideoProcessor):
            @property
            def backend(self):
                return ProcessingBackend.CPU_ONLY

            def is_available(self):
                return True
            # Missing: process_clip, concatenate_clips, apply_overlay

        with pytest.raises(TypeError):
            PartialProcessor()
