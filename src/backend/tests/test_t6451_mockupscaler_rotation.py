"""Regression test for T6451: clip_pipeline.py always calls
upscaler.process_video_with_upscale(..., rotation=...) (clip_pipeline.py:347),
regardless of whether the upscaler is the real AIVideoUpscaler (accepts
rotation) or MockVideoUpscaler (the local/CI pipeline-verification fallback,
which did not). Any local-mode export of a clip with rotation set crashed
with `TypeError: process_video_with_upscale() got an unexpected keyword
argument 'rotation'`.

Fixed by adding rotation to MockVideoUpscaler's signature to match the real
interface. The mock does not attempt to actually apply the rotation (no
frame_processor here, unlike the real class) -- it logs loudly instead
(no silent fallback for internal data, per project convention).
"""

import logging

import pytest

from app.services.local_processors import MockVideoUpscaler


def test_rotation_kwarg_accepted_without_typeerror(tmp_path):
    """The exact T6451 crash mode: rotation must not raise TypeError."""
    up = MockVideoUpscaler()
    # Nonexistent input -> RuntimeError from the ffprobe step (same failure
    # mode as test_local_processor_raises_on_probe_failure in
    # test_t4280_silent_fallbacks.py) -- proves rotation was accepted and
    # execution proceeded past argument binding, not rejected as an
    # unexpected keyword.
    with pytest.raises(RuntimeError):
        up.process_video_with_upscale(
            input_path="/nonexistent/bad.mp4",
            output_path=str(tmp_path / "out.mp4"),
            keyframes=[{"x": 0, "y": 0, "width": 1, "height": 1}],
            rotation=90,
        )


def test_nonzero_rotation_warns_loudly_not_silently(tmp_path, caplog):
    """Rotation is accepted but not applied by the mock -- must warn, not
    silently drop the value (CLAUDE.md: no silent fallbacks for internal data)."""
    up = MockVideoUpscaler()
    with caplog.at_level(logging.WARNING), pytest.raises(RuntimeError):
        up.process_video_with_upscale(
            input_path="/nonexistent/bad.mp4",
            output_path=str(tmp_path / "out.mp4"),
            keyframes=[{"x": 0, "y": 0, "width": 1, "height": 1}],
            rotation=90,
        )
    assert any("rotation" in r.message.lower() and "not applied" in r.message.lower()
               for r in caplog.records)


def test_zero_rotation_no_warning(tmp_path, caplog):
    """The default/common case (rotation=0) must not warn on every export."""
    up = MockVideoUpscaler()
    with caplog.at_level(logging.WARNING), pytest.raises(RuntimeError):
        up.process_video_with_upscale(
            input_path="/nonexistent/bad.mp4",
            output_path=str(tmp_path / "out.mp4"),
            keyframes=[{"x": 0, "y": 0, "width": 1, "height": 1}],
            rotation=0,
        )
    assert not any("rotation" in r.message.lower() for r in caplog.records)
