"""
Tests for clip processing pipeline.
"""

import pytest
import os
import tempfile
from unittest.mock import MagicMock, AsyncMock, patch

from app.services.clip_pipeline import (
    ClipProcessingPipeline,
    PipelineStage,
    PipelineError,
    ClipProcessingContext,
    process_clip_with_pipeline,
)


class TestPipelineStage:
    """Tests for PipelineStage enum."""

    def test_stages_are_ordered(self):
        """Stages should be in processing order."""
        stages = list(PipelineStage)
        assert stages[0] == PipelineStage.INIT
        assert stages[1] == PipelineStage.SAVED
        assert stages[2] == PipelineStage.CONFIGURED
        assert stages[3] == PipelineStage.CACHE_CHECKED
        assert stages[4] == PipelineStage.PROCESSED
        assert stages[5] == PipelineStage.CACHED


class TestClipProcessingContext:
    """Tests for ClipProcessingContext dataclass."""

    def test_default_values(self):
        """Context has sensible defaults."""
        ctx = ClipProcessingContext(
            clip_index=0,
            clip_data={},
            video_content=b"test",
            temp_dir="/tmp"
        )
        assert ctx.target_fps == 30
        assert ctx.export_mode == "quality"
        assert ctx.include_audio is True
        assert ctx.keyframes == []
        assert ctx.cache_hit is False


class TestClipProcessingPipeline:
    """Tests for ClipProcessingPipeline class."""

    @pytest.fixture
    def sample_clip_data(self):
        """Sample clip data for testing."""
        return {
            'clipIndex': 0,
            'duration': 10.0,
            'cropKeyframes': [
                {'time': 0, 'x': 0, 'y': 0, 'width': 100, 'height': 100},
                {'time': 5, 'x': 10, 'y': 10, 'width': 100, 'height': 100},
            ],
            'segments': {
                'boundaries': [0, 5, 10],
                'segmentSpeeds': {'0': 1.0, '1': 2.0}
            },
            'trimRange': {'start': 1, 'end': 9}
        }

    @pytest.fixture
    def temp_dir(self):
        """Create temp directory for tests."""
        with tempfile.TemporaryDirectory() as td:
            yield td

    def test_init_stage(self, sample_clip_data, temp_dir):
        """Pipeline starts at INIT stage."""
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=b"test video content",
            temp_dir=temp_dir
        )
        assert pipeline.stage == PipelineStage.INIT
        assert pipeline.context.clip_index == 0

    def test_save_to_temp(self, sample_clip_data, temp_dir):
        """save_to_temp saves file and computes hash."""
        content = b"test video content"
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=content,
            temp_dir=temp_dir
        )

        input_path = pipeline.save_to_temp()

        assert pipeline.stage == PipelineStage.SAVED
        assert os.path.exists(input_path)
        assert pipeline.context.content_identity is not None
        assert "|" in pipeline.context.content_identity  # hash|size format

        # Verify content was saved correctly
        with open(input_path, 'rb') as f:
            assert f.read() == content

    def test_save_to_temp_requires_init(self, sample_clip_data, temp_dir):
        """save_to_temp can only be called at INIT stage."""
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=b"test",
            temp_dir=temp_dir
        )
        pipeline.save_to_temp()

        # Can't save again
        with pytest.raises(PipelineError) as exc_info:
            pipeline.save_to_temp()
        assert "INIT" in str(exc_info.value)

    def test_configure_processing(self, sample_clip_data, temp_dir):
        """configure_processing sets up keyframes and segments."""
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=b"test",
            temp_dir=temp_dir
        )
        pipeline.save_to_temp()
        pipeline.configure_processing(target_fps=60, export_mode="speed", include_audio=False)

        assert pipeline.stage == PipelineStage.CONFIGURED
        assert pipeline.context.target_fps == 60
        assert pipeline.context.export_mode == "speed"
        assert pipeline.context.include_audio is False
        assert len(pipeline.context.keyframes) == 2
        assert pipeline.context.segment_data is not None
        assert pipeline.context.segment_data['trim_start'] == 1
        assert pipeline.context.segment_data['trim_end'] == 9

    def test_configure_requires_saved(self, sample_clip_data, temp_dir):
        """configure_processing requires SAVED stage."""
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=b"test",
            temp_dir=temp_dir
        )

        with pytest.raises(PipelineError) as exc_info:
            pipeline.configure_processing()
        assert "SAVED" in str(exc_info.value)

    def test_configure_without_segments(self, temp_dir):
        """configure_processing works without segments."""
        clip_data = {
            'clipIndex': 0,
            'cropKeyframes': []
        }
        pipeline = ClipProcessingPipeline(
            clip_data=clip_data,
            video_content=b"test",
            temp_dir=temp_dir
        )
        pipeline.save_to_temp()
        pipeline.configure_processing()

        assert pipeline.stage == PipelineStage.CONFIGURED
        assert pipeline.context.segment_data is None

    def test_check_cache_hit(self, sample_clip_data, temp_dir):
        """check_cache returns True on cache hit."""
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=b"test",
            temp_dir=temp_dir
        )
        pipeline.save_to_temp()
        pipeline.configure_processing()

        # Mock cache with hit
        mock_cache = MagicMock()
        mock_cache.generate_key.return_value = "test_key"

        # Create a fake cached file
        cached_file = os.path.join(temp_dir, "cached.mp4")
        with open(cached_file, 'wb') as f:
            f.write(b"cached content")
        mock_cache.get.return_value = cached_file

        result = pipeline.check_cache(mock_cache)

        assert result is True
        assert pipeline.stage == PipelineStage.CACHE_CHECKED
        assert pipeline.context.cache_hit is True
        # Output should have been copied from cache
        assert os.path.exists(pipeline.output_path)

    def test_check_cache_miss(self, sample_clip_data, temp_dir):
        """check_cache returns False on cache miss."""
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=b"test",
            temp_dir=temp_dir
        )
        pipeline.save_to_temp()
        pipeline.configure_processing()

        # Mock cache with miss
        mock_cache = MagicMock()
        mock_cache.generate_key.return_value = "test_key"
        mock_cache.get.return_value = None

        result = pipeline.check_cache(mock_cache)

        assert result is False
        assert pipeline.stage == PipelineStage.CACHE_CHECKED
        assert pipeline.context.cache_hit is False

    def test_check_cache_requires_configured(self, sample_clip_data, temp_dir):
        """check_cache requires CONFIGURED stage."""
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=b"test",
            temp_dir=temp_dir
        )
        pipeline.save_to_temp()

        mock_cache = MagicMock()
        with pytest.raises(PipelineError) as exc_info:
            pipeline.check_cache(mock_cache)
        assert "CONFIGURED" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_process_cache_hit_returns_immediately(self, sample_clip_data, temp_dir):
        """process() returns immediately on cache hit."""
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=b"test",
            temp_dir=temp_dir
        )
        pipeline.save_to_temp()
        pipeline.configure_processing()

        # Simulate cache hit
        cached_file = os.path.join(temp_dir, "cached.mp4")
        with open(cached_file, 'wb') as f:
            f.write(b"cached")

        mock_cache = MagicMock()
        mock_cache.generate_key.return_value = "key"
        mock_cache.get.return_value = cached_file
        pipeline.check_cache(mock_cache)

        # Process should return without calling upscaler
        mock_upscaler = MagicMock()
        result = await pipeline.process(mock_upscaler)

        assert result == pipeline.output_path
        assert pipeline.stage == PipelineStage.PROCESSED
        mock_upscaler.process_video_with_upscale.assert_not_called()

    @pytest.mark.asyncio
    async def test_process_cache_miss_calls_upscaler(self, sample_clip_data, temp_dir):
        """process() calls upscaler on cache miss."""
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=b"test",
            temp_dir=temp_dir
        )
        pipeline.save_to_temp()
        pipeline.configure_processing()

        # Simulate cache miss
        mock_cache = MagicMock()
        mock_cache.generate_key.return_value = "key"
        mock_cache.get.return_value = None
        pipeline.check_cache(mock_cache)

        # Mock upscaler
        mock_upscaler = MagicMock()
        mock_upscaler.process_video_with_upscale = MagicMock()

        with patch('asyncio.to_thread', new_callable=AsyncMock) as mock_to_thread:
            result = await pipeline.process(mock_upscaler)

        assert result == pipeline.output_path
        assert pipeline.stage == PipelineStage.PROCESSED
        mock_to_thread.assert_called_once()

    def test_store_in_cache_on_miss(self, sample_clip_data, temp_dir):
        """store_in_cache stores result on cache miss."""
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=b"test",
            temp_dir=temp_dir
        )
        pipeline.save_to_temp()
        pipeline.configure_processing()

        mock_cache = MagicMock()
        mock_cache.generate_key.return_value = "key"
        mock_cache.get.return_value = None
        pipeline.check_cache(mock_cache)

        # Manually advance to PROCESSED (skip actual processing)
        pipeline._stage = PipelineStage.PROCESSED

        result = pipeline.store_in_cache(mock_cache)

        assert result is True
        assert pipeline.stage == PipelineStage.CACHED
        mock_cache.put.assert_called_once()

    def test_store_in_cache_skipped_on_hit(self, sample_clip_data, temp_dir):
        """store_in_cache does nothing on cache hit."""
        pipeline = ClipProcessingPipeline(
            clip_data=sample_clip_data,
            video_content=b"test",
            temp_dir=temp_dir
        )
        pipeline.save_to_temp()
        pipeline.configure_processing()

        # Simulate cache hit
        cached_file = os.path.join(temp_dir, "cached.mp4")
        with open(cached_file, 'wb') as f:
            f.write(b"cached")

        mock_cache = MagicMock()
        mock_cache.generate_key.return_value = "key"
        mock_cache.get.return_value = cached_file
        pipeline.check_cache(mock_cache)

        # Manually advance to PROCESSED
        pipeline._stage = PipelineStage.PROCESSED

        result = pipeline.store_in_cache(mock_cache)

        assert result is False
        assert pipeline.stage == PipelineStage.CACHED
        mock_cache.put.assert_not_called()


class TestProcessClipWithPipeline:
    """Tests for process_clip_with_pipeline helper function."""

    @pytest.fixture
    def temp_dir(self):
        """Create temp directory for tests."""
        with tempfile.TemporaryDirectory() as td:
            yield td

    @pytest.mark.asyncio
    async def test_full_pipeline_cache_hit(self, temp_dir):
        """Full pipeline with cache hit."""
        clip_data = {'clipIndex': 0, 'cropKeyframes': []}

        # Create cached file
        cached_file = os.path.join(temp_dir, "cached.mp4")
        with open(cached_file, 'wb') as f:
            f.write(b"cached content")

        mock_cache = MagicMock()
        mock_cache.generate_key.return_value = "key"
        mock_cache.get.return_value = cached_file

        mock_upscaler = MagicMock()
        mock_callback = MagicMock()

        result = await process_clip_with_pipeline(
            clip_data=clip_data,
            video_content=b"test video",
            temp_dir=temp_dir,
            target_fps=30,
            export_mode="quality",
            include_audio=True,
            cache=mock_cache,
            upscaler=mock_upscaler,
            progress_callback=mock_callback
        )

        assert os.path.exists(result)
        mock_callback.assert_called_with(1, 1, "Using cached result", 'cached')
        mock_upscaler.process_video_with_upscale.assert_not_called()

    @pytest.mark.asyncio
    async def test_full_pipeline_cache_miss(self, temp_dir):
        """Full pipeline with cache miss."""
        clip_data = {'clipIndex': 0, 'cropKeyframes': []}

        mock_cache = MagicMock()
        mock_cache.generate_key.return_value = "key"
        mock_cache.get.return_value = None

        mock_upscaler = MagicMock()

        with patch('asyncio.to_thread', new_callable=AsyncMock) as mock_to_thread:
            result = await process_clip_with_pipeline(
                clip_data=clip_data,
                video_content=b"test video",
                temp_dir=temp_dir,
                target_fps=30,
                export_mode="quality",
                include_audio=True,
                cache=mock_cache,
                upscaler=mock_upscaler,
                progress_callback=None
            )

        assert result is not None
        mock_to_thread.assert_called_once()
        mock_cache.put.assert_called_once()


class TestPipelineError:
    """Tests for PipelineError exception."""

    def test_pipeline_error_message(self):
        """PipelineError has descriptive message."""
        err = PipelineError("Test error message")
        assert "Test error message" in str(err)

    def test_pipeline_error_is_exception(self):
        """PipelineError is a proper exception."""
        with pytest.raises(PipelineError):
            raise PipelineError("test")
