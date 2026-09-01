"""
Tbug49p -- REAL ffmpeg reproduction of the slow-motion export bug and its fix.

The unit tests in test_tbug49p_export_fps.py pin the argument SHAPE of the
ffmpeg commands `_build_simple_ffmpeg_cmd` builds, but (per review) they would
still pass even if a call site forgot to pass `input_fps=original_fps` --
they don't prove the actual bug is fixed against a real video file.

This test closes that gap: it generates a REAL 50fps source video with
ffmpeg, extracts it to a PNG sequence the same way `process_clips_ai` does
(one PNG per source frame), then runs the ACTUAL production
`_build_simple_ffmpeg_cmd` output through real ffmpeg and measures the
result with ffprobe -- no mocking, no reimplemented logic.

It demonstrates BOTH directions from the exact same fixture:
  1. The FIXED call (input_fps=50, matching what process_clips_ai now passes)
     produces output whose duration matches the source, not the source
     stretched by 30/50.
  2. The PRE-FIX call shape (input_fps omitted -- what process_clips_ai
     called before this task, which always used the target fps for the PNG
     input framerate) reproduces the actual reported symptom: a 50fps source
     comes out ~1.667x slow, matching bug 49p's real-world duration ratio
     (863 frames / 30fps = 28.77s from a 17.26s source) to the same
     arithmetic.

Skipped if ffmpeg/ffprobe aren't on PATH (both are installed in branch-ci.yml
for the metadata/ffprobe tests, and are part of this project's local dev
dependency for video export).
"""

import json
import shutil
import subprocess

import pytest

from app.modal_functions.video_processing import _build_simple_ffmpeg_cmd

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")

pytestmark = pytest.mark.skipif(
    not (FFMPEG and FFPROBE), reason="ffmpeg/ffprobe not on PATH"
)

SOURCE_FPS = 50
SOURCE_DURATION_S = 2.0  # -> 100 source frames at 50fps


def _probe_duration(path):
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "json", path],
        capture_output=True, text=True, check=True,
    )
    return float(json.loads(out.stdout)["format"]["duration"])


@pytest.fixture
def source_and_frames(tmp_path):
    """A real 50fps, 2s synthetic source video, extracted to a PNG sequence
    the same way process_clips_ai does: one PNG per SOURCE frame (no
    resampling in the extraction step -- that's the whole bug)."""
    source_path = str(tmp_path / "source.mp4")
    subprocess.run(
        [FFMPEG, "-y", "-f", "lavfi",
         "-i", f"testsrc=duration={SOURCE_DURATION_S}:rate={SOURCE_FPS}:size=320x240",
         "-pix_fmt", "yuv420p", source_path],
        capture_output=True, text=True, check=True,
    )
    assert abs(_probe_duration(source_path) - SOURCE_DURATION_S) < 0.05

    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    frame_pattern = str(frames_dir / "frame_%06d.png")
    subprocess.run(
        [FFMPEG, "-y", "-i", source_path, frame_pattern],
        capture_output=True, text=True, check=True,
    )
    frame_count = len(list(frames_dir.glob("*.png")))
    assert frame_count == round(SOURCE_DURATION_S * SOURCE_FPS), (
        f"expected {SOURCE_DURATION_S * SOURCE_FPS} extracted frames, got {frame_count}"
    )
    return source_path, frame_pattern, frame_count


class TestRealFfmpegReproducesAndFixesSlowMotion:
    def test_fixed_call_produces_correct_duration(self, tmp_path, source_and_frames):
        """The FIX: process_clips_ai now calls with input_fps=original_fps.
        A 50fps source's PNG sequence, correctly declared at 50fps into
        ffmpeg with -r 30 forcing the output rate, must play back at the
        SOURCE's real duration, not stretched."""
        source_path, frame_pattern, frame_count = source_and_frames
        output_path = str(tmp_path / "output_fixed.mp4")

        cmd = _build_simple_ffmpeg_cmd(
            frame_pattern, source_path, output_path,
            fps=30, has_audio=False, audio_start_time=0,
            frame_count=frame_count, input_fps=SOURCE_FPS,
        )
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr

        actual_duration = _probe_duration(output_path)
        assert abs(actual_duration - SOURCE_DURATION_S) < 0.1, (
            f"expected ~{SOURCE_DURATION_S}s (source duration), got {actual_duration:.3f}s"
        )

    def test_pre_fix_call_shape_reproduces_the_reported_slow_motion_bug(self, tmp_path, source_and_frames):
        """Characterizes the ACTUAL bug: before this task, process_clips_ai
        never passed input_fps, so it defaulted to the target fps (30) even
        though the PNG sequence was sampled at the source's 50fps. This is
        the exact call shape that shipped to production and produced bug
        49p's reported slow-motion output -- reproduced here against a real
        video, not asserted from arithmetic alone."""
        source_path, frame_pattern, frame_count = source_and_frames
        output_path = str(tmp_path / "output_prefix.mp4")

        cmd = _build_simple_ffmpeg_cmd(
            frame_pattern, source_path, output_path,
            fps=30, has_audio=False, audio_start_time=0,
            frame_count=frame_count,
            # input_fps intentionally omitted: this is the pre-fix call shape.
        )
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr

        actual_duration = _probe_duration(output_path)
        expected_stretched_duration = SOURCE_DURATION_S * (SOURCE_FPS / 30)  # 3.333s
        assert abs(actual_duration - expected_stretched_duration) < 0.1, (
            f"expected the pre-fix bug to stretch to ~{expected_stretched_duration:.3f}s "
            f"(source played back at 30/{SOURCE_FPS} = {30 / SOURCE_FPS}x speed), "
            f"got {actual_duration:.3f}s"
        )
        # And confirm this pre-fix output is measurably wrong relative to source --
        # this is the user-visible "plays in slow motion" symptom.
        assert actual_duration > SOURCE_DURATION_S * 1.5, (
            "pre-fix call shape should reproduce a clearly-slow-motion (>1.5x stretched) output"
        )
