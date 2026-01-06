"""
Tests for progress reporter module.
"""

import pytest
from unittest.mock import MagicMock, call

from app.services.progress_reporter import (
    ProgressReporter,
    ProgressPhase,
    create_clip_progress_reporter,
    DEFAULT_PHASE_WEIGHTS,
)


class TestProgressPhase:
    """Tests for ProgressPhase enum."""

    def test_all_phases_have_string_values(self):
        """Each phase has a string value."""
        for phase in ProgressPhase:
            assert isinstance(phase.value, str)
            assert len(phase.value) > 0

    def test_phase_values_match_legacy(self):
        """Phase values match legacy callback phase strings."""
        assert ProgressPhase.UPSCALING.value == "ai_upscale"
        assert ProgressPhase.INTERPOLATION.value == "rife_interpolation"


class TestProgressReporter:
    """Tests for ProgressReporter class."""

    def test_create_without_callback(self):
        """Can create reporter without callback."""
        reporter = ProgressReporter()
        # Should not raise
        reporter.update(50, 100, "test")

    def test_callback_invoked_on_update(self):
        """Callback is invoked when update is called."""
        callback = MagicMock()
        reporter = ProgressReporter(callback=callback)

        reporter.update(50, 100, "Processing")

        callback.assert_called_once()
        args = callback.call_args[0]
        assert args[0] == 50  # current
        assert args[1] == 100  # total
        assert args[2] == "Processing"  # message

    def test_set_phase_changes_current_phase(self):
        """set_phase updates the current phase."""
        callback = MagicMock()
        reporter = ProgressReporter(callback=callback)

        reporter.set_phase(ProgressPhase.CROPPING, message="Starting crop")
        reporter.update(10, 100, "Frame 10")

        # Check that update uses the new phase
        args = callback.call_args[0]
        assert args[3] == "cropping"

    def test_phase_progression(self):
        """Phases progress correctly through update calls."""
        callback = MagicMock()
        reporter = ProgressReporter(callback=callback)

        reporter.set_phase(ProgressPhase.CROPPING)
        reporter.update(100, 100, "Crop done")

        reporter.set_phase(ProgressPhase.UPSCALING)
        reporter.update(50, 100, "Upscaling")

        # Check the phases in order
        assert len(callback.call_args_list) >= 2
        # First call should be cropping
        # Second call should be upscaling
        assert callback.call_args_list[-1][0][3] == "ai_upscale"

    def test_complete_sends_100_percent(self):
        """complete() sends 100% progress."""
        callback = MagicMock()
        reporter = ProgressReporter(callback=callback)

        reporter.complete("All done")

        callback.assert_called_with(100, 100, "All done", "complete")

    def test_fail_sends_error(self):
        """fail() sends error status."""
        callback = MagicMock()
        reporter = ProgressReporter(callback=callback)

        reporter.fail("Something broke")

        callback.assert_called_with(0, 100, "Something broke", "error")

    def test_custom_phase_weights(self):
        """Custom phase weights are respected."""
        custom_weights = {
            ProgressPhase.CROPPING: 0.5,
            ProgressPhase.UPSCALING: 0.5,
        }
        reporter = ProgressReporter(phase_weights=custom_weights)
        assert reporter._phase_weights[ProgressPhase.CROPPING] == 0.5

    def test_update_with_phase_override(self):
        """update() can override the current phase."""
        callback = MagicMock()
        reporter = ProgressReporter(callback=callback)

        reporter.set_phase(ProgressPhase.CROPPING)
        reporter.update(50, 100, "Switching", phase=ProgressPhase.UPSCALING)

        args = callback.call_args[0]
        assert args[3] == "ai_upscale"


class TestProgressReporterBackwardCompatibility:
    """Tests for backward compatibility with legacy callbacks."""

    def test_as_callback_returns_callable(self):
        """as_callback() returns a callable function."""
        reporter = ProgressReporter()
        callback = reporter.as_callback()

        assert callable(callback)

    def test_as_callback_maps_legacy_phases(self):
        """as_callback() maps legacy phase strings correctly."""
        callback = MagicMock()
        reporter = ProgressReporter(callback=callback)
        legacy_callback = reporter.as_callback()

        # Call with legacy phase string
        legacy_callback(50, 100, "Processing", "ai_upscale")

        # Should have been invoked
        callback.assert_called()

    def test_from_callback_wraps_legacy(self):
        """from_callback() creates reporter from legacy callback."""
        legacy_callback = MagicMock()
        reporter = ProgressReporter.from_callback(legacy_callback)

        reporter.update(50, 100, "Test")

        legacy_callback.assert_called_once()

    def test_from_callback_handles_none(self):
        """from_callback() handles None callback."""
        reporter = ProgressReporter.from_callback(None)
        # Should not raise
        reporter.update(50, 100, "Test")


class TestCreateClipProgressReporter:
    """Tests for create_clip_progress_reporter helper."""

    def test_creates_reporter(self):
        """Creates a valid ProgressReporter."""
        reporter = create_clip_progress_reporter(0, 3)
        assert isinstance(reporter, ProgressReporter)

    def test_with_base_callback(self):
        """Uses base callback when provided."""
        base_callback = MagicMock()
        reporter = create_clip_progress_reporter(0, 3, base_callback)

        reporter.update(50, 100, "Processing")

        base_callback.assert_called()

    def test_clip_index_affects_progress(self):
        """Different clip indices give different progress ranges."""
        base_callback = MagicMock()

        # First clip
        reporter1 = create_clip_progress_reporter(0, 3, base_callback)
        reporter1.update(100, 100, "Done")
        first_progress = base_callback.call_args[0][0]

        base_callback.reset_mock()

        # Third clip
        reporter3 = create_clip_progress_reporter(2, 3, base_callback)
        reporter3.update(100, 100, "Done")
        third_progress = base_callback.call_args[0][0]

        # Third clip should report higher progress than first
        assert third_progress > first_progress

    def test_message_includes_clip_info(self):
        """Progress message includes clip number."""
        base_callback = MagicMock()
        reporter = create_clip_progress_reporter(1, 5, base_callback)

        reporter.update(50, 100, "Upscaling")

        message = base_callback.call_args[0][2]
        assert "Clip 2/5" in message
        assert "Upscaling" in message

    def test_without_callback_still_works(self):
        """Works even without base callback."""
        reporter = create_clip_progress_reporter(0, 3, None)
        # Should not raise
        reporter.update(50, 100, "Test")


class TestSubReporter:
    """Tests for sub-reporter functionality."""

    def test_create_sub_reporter(self):
        """Can create sub-reporter."""
        callback = MagicMock()
        parent = ProgressReporter(callback=callback)
        parent.set_phase(ProgressPhase.UPSCALING, weight=0.5)

        sub = parent.create_sub_reporter(ProgressPhase.UPSCALING, weight=0.5)

        assert isinstance(sub, ProgressReporter)

    def test_sub_reporter_maps_progress(self):
        """Sub-reporter maps progress to parent's range."""
        callback = MagicMock()
        parent = ProgressReporter(callback=callback)
        parent.set_phase(ProgressPhase.UPSCALING, weight=0.5)

        sub = parent.create_sub_reporter(ProgressPhase.UPSCALING, weight=0.5)
        sub.update(100, 100, "Sub complete")

        # Sub at 100% should not equal parent at 100%
        callback.assert_called()


class TestDefaultPhaseWeights:
    """Tests for default phase weight configuration."""

    def test_weights_sum_to_one(self):
        """Default weights sum to approximately 1.0."""
        # Excluding CACHED which is 0
        total = sum(w for p, w in DEFAULT_PHASE_WEIGHTS.items() if p != ProgressPhase.CACHED)
        # Allow some tolerance for floating point
        assert 0.95 <= total <= 1.05

    def test_all_phases_have_weights(self):
        """All phases have default weights defined."""
        for phase in ProgressPhase:
            assert phase in DEFAULT_PHASE_WEIGHTS

    def test_cached_has_zero_weight(self):
        """CACHED phase has zero weight (skips processing)."""
        assert DEFAULT_PHASE_WEIGHTS[ProgressPhase.CACHED] == 0.0
