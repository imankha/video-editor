"""
Tests for transition strategies.

These tests verify the Strategy pattern implementation for video transitions.
"""

import pytest
from unittest.mock import patch, MagicMock
import subprocess


class TestTransitionFactory:
    """Tests for TransitionFactory."""

    def test_create_cut_transition(self):
        """Factory creates CutTransition for 'cut' type."""
        from app.services.transitions import TransitionFactory, CutTransition

        strategy = TransitionFactory.create('cut')
        assert isinstance(strategy, CutTransition)
        assert strategy.name == 'cut'

    def test_create_fade_transition(self):
        """Factory creates FadeTransition for 'fade' type."""
        from app.services.transitions import TransitionFactory, FadeTransition

        strategy = TransitionFactory.create('fade')
        assert isinstance(strategy, FadeTransition)
        assert strategy.name == 'fade'

    def test_create_dissolve_transition(self):
        """Factory creates DissolveTransition for 'dissolve' type."""
        from app.services.transitions import TransitionFactory, DissolveTransition

        strategy = TransitionFactory.create('dissolve')
        assert isinstance(strategy, DissolveTransition)
        assert strategy.name == 'dissolve'

    def test_create_case_insensitive(self):
        """Factory handles case-insensitive transition names."""
        from app.services.transitions import TransitionFactory, FadeTransition

        strategy = TransitionFactory.create('FADE')
        assert isinstance(strategy, FadeTransition)

        strategy = TransitionFactory.create('Fade')
        assert isinstance(strategy, FadeTransition)

    def test_create_unknown_raises_error(self):
        """Factory raises ValueError for unknown transition type."""
        from app.services.transitions import TransitionFactory

        with pytest.raises(ValueError) as exc_info:
            TransitionFactory.create('wipe')

        assert 'Unknown transition type' in str(exc_info.value)
        assert 'wipe' in str(exc_info.value)

    def test_get_available_returns_all_types(self):
        """Factory reports all registered transition types."""
        from app.services.transitions import TransitionFactory

        available = TransitionFactory.get_available()
        assert 'cut' in available
        assert 'fade' in available
        assert 'dissolve' in available


class TestCutTransition:
    """Tests for CutTransition."""

    def test_name_property(self):
        """Cut transition reports correct name."""
        from app.services.transitions import CutTransition

        transition = CutTransition()
        assert transition.name == 'cut'

    def test_single_clip_copies_file(self, tmp_path):
        """Single clip just copies the file."""
        from app.services.transitions import CutTransition

        # Create mock input file
        input_file = tmp_path / "input.mp4"
        input_file.write_text("mock video content")

        output_file = tmp_path / "output.mp4"

        transition = CutTransition()
        result = transition.concatenate(
            clip_paths=[str(input_file)],
            output_path=str(output_file),
            duration=0.5
        )

        assert result is True
        assert output_file.exists()
        assert output_file.read_text() == "mock video content"

    def test_empty_clips_returns_false(self):
        """Empty clip list returns False."""
        from app.services.transitions import CutTransition

        transition = CutTransition()
        result = transition.concatenate(
            clip_paths=[],
            output_path="/fake/output.mp4",
            duration=0.5
        )

        assert result is False

    @patch('subprocess.run')
    def test_multiple_clips_builds_concat_command(self, mock_run, tmp_path):
        """Multiple clips uses FFmpeg concat demuxer."""
        from app.services.transitions import CutTransition

        mock_run.return_value = MagicMock(returncode=0)

        input1 = tmp_path / "clip1.mp4"
        input2 = tmp_path / "clip2.mp4"
        input1.write_bytes(b"clip1")
        input2.write_bytes(b"clip2")
        output = tmp_path / "output.mp4"

        transition = CutTransition()
        result = transition.concatenate(
            clip_paths=[str(input1), str(input2)],
            output_path=str(output),
            duration=0.5,
            include_audio=True
        )

        assert result is True
        assert mock_run.called

        # Verify FFmpeg command
        cmd = mock_run.call_args[0][0]
        assert 'ffmpeg' in cmd
        assert '-f' in cmd
        assert 'concat' in cmd
        assert '-c:a' in cmd
        assert 'aac' in cmd


class TestFadeTransition:
    """Tests for FadeTransition."""

    def test_name_property(self):
        """Fade transition reports correct name."""
        from app.services.transitions import FadeTransition

        transition = FadeTransition()
        assert transition.name == 'fade'

    def test_empty_clips_returns_false(self):
        """Empty clip list returns False."""
        from app.services.transitions import FadeTransition

        transition = FadeTransition()
        result = transition.concatenate(
            clip_paths=[],
            output_path="/fake/output.mp4",
            duration=0.5
        )

        assert result is False

    @patch('app.services.transitions.fade.get_video_duration')
    @patch('subprocess.run')
    def test_builds_fade_filter_complex(self, mock_run, mock_duration, tmp_path):
        """Fade transition builds correct filter_complex."""
        from app.services.transitions import FadeTransition

        mock_run.return_value = MagicMock(returncode=0)
        mock_duration.return_value = 5.0  # 5 seconds per clip

        input1 = tmp_path / "clip1.mp4"
        input2 = tmp_path / "clip2.mp4"
        input1.write_bytes(b"clip1")
        input2.write_bytes(b"clip2")
        output = tmp_path / "output.mp4"

        transition = FadeTransition()
        result = transition.concatenate(
            clip_paths=[str(input1), str(input2)],
            output_path=str(output),
            duration=0.5,
            include_audio=True
        )

        assert result is True

        # Verify FFmpeg command has filter_complex
        cmd = mock_run.call_args[0][0]
        assert '-filter_complex' in cmd
        filter_idx = cmd.index('-filter_complex')
        filter_complex = cmd[filter_idx + 1]

        # Check for fade filters
        assert 'fade=t=out' in filter_complex
        assert 'fade=t=in' in filter_complex
        assert 'concat=' in filter_complex


class TestDissolveTransition:
    """Tests for DissolveTransition."""

    def test_name_property(self):
        """Dissolve transition reports correct name."""
        from app.services.transitions import DissolveTransition

        transition = DissolveTransition()
        assert transition.name == 'dissolve'

    def test_empty_clips_returns_false(self):
        """Empty clip list returns False."""
        from app.services.transitions import DissolveTransition

        transition = DissolveTransition()
        result = transition.concatenate(
            clip_paths=[],
            output_path="/fake/output.mp4",
            duration=0.5
        )

        assert result is False

    @patch('app.services.transitions.dissolve.get_video_duration')
    @patch('subprocess.run')
    def test_builds_xfade_filter(self, mock_run, mock_duration, tmp_path):
        """Dissolve transition uses xfade filter."""
        from app.services.transitions import DissolveTransition

        mock_run.return_value = MagicMock(returncode=0)
        mock_duration.return_value = 5.0

        input1 = tmp_path / "clip1.mp4"
        input2 = tmp_path / "clip2.mp4"
        input1.write_bytes(b"clip1")
        input2.write_bytes(b"clip2")
        output = tmp_path / "output.mp4"

        transition = DissolveTransition()
        result = transition.concatenate(
            clip_paths=[str(input1), str(input2)],
            output_path=str(output),
            duration=0.5,
            include_audio=True
        )

        assert result is True

        # Verify xfade filter is used
        cmd = mock_run.call_args[0][0]
        assert '-filter_complex' in cmd
        filter_idx = cmd.index('-filter_complex')
        filter_complex = cmd[filter_idx + 1]

        assert 'xfade=transition=dissolve' in filter_complex
        assert 'acrossfade' in filter_complex


class TestApplyTransition:
    """Tests for apply_transition convenience function."""

    @patch('app.services.transitions.TransitionFactory.create')
    def test_applies_correct_strategy(self, mock_create):
        """apply_transition uses correct strategy."""
        from app.services.transitions import apply_transition

        mock_strategy = MagicMock()
        mock_strategy.concatenate.return_value = True
        mock_create.return_value = mock_strategy

        result = apply_transition(
            transition_type='fade',
            clip_paths=['clip1.mp4', 'clip2.mp4'],
            output_path='output.mp4',
            duration=0.5
        )

        assert result is True
        mock_create.assert_called_once_with('fade')
        mock_strategy.concatenate.assert_called_once()

    @patch('app.services.transitions.TransitionFactory.create')
    def test_falls_back_to_cut_on_error(self, mock_create):
        """apply_transition falls back to cut on invalid type."""
        from app.services.transitions import apply_transition, CutTransition

        # First call raises ValueError, second returns cut
        mock_cut = MagicMock()
        mock_cut.concatenate.return_value = True
        mock_create.side_effect = [ValueError("Unknown"), mock_cut]

        result = apply_transition(
            transition_type='invalid',
            clip_paths=['clip1.mp4'],
            output_path='output.mp4'
        )

        assert result is True
        # Should have tried invalid first, then cut
        assert mock_create.call_count == 2
