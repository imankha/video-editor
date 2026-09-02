"""
T8280 -- REAL ffmpeg reproduction of the down-sample (30fps cost-saving choice)
export path. Mirrors test_tbug49p_export_fps_repro.py exactly: no mocking, real
ffmpeg + ffprobe, characterizing the ACTUAL bytes rather than arithmetic alone.
Design: docs/plans/tasks/T8280-design.md (Option B scope).

Since the real Modal GPU read-loop (`process_clips_ai`, cv2 + Real-ESRGAN) can't
run in this environment, this test simulates what the FIXED read loop would
produce: it builds a real 50fps 2s synthetic source, extracts the full source
frame sequence (same as Tbug49p's fixture), then CONSTRUCTS the down-sampled
PNG sequence itself using the SAME integer-cadence grid formula the Implementor
is expected to use in the read loop (`int(frame_num_rel * target_fps /
original_fps)` advancing -- see test_t8280_fps_export_choice.py's
`_should_emit_downsampled_frame` recommendation), by symlinking/copying only
the frames that land on the grid into a fresh sequential-numbered directory.
It then runs the ACTUAL production `_build_simple_ffmpeg_cmd` /
`_build_speed_change_ffmpeg_cmd` with the down-sample call shape
(input_fps=target_fps=30) through real ffmpeg and verifies via ffprobe.

This currently FAILS (or rather: the assertions about `_build_simple_ffmpeg_cmd`
call shape below will PASS today since the builder itself isn't changing -- the
part that's a genuine regression-guard-until-implemented is
`test_t8280_fps_export_choice.py`'s grid-emission unit tests, which import a
not-yet-existing helper. This repro file's job is to prove the END-TO-END
ffmpeg round-trip is correct once Stage 1 wires input_fps=target_fps for the
down-sample case -- i.e. it's a spec for the caller wiring, verified against
real ffmpeg, not a bug reproduction of currently-broken output.)

Skipped if ffmpeg/ffprobe aren't on PATH.
"""

import json
import shutil
import subprocess

import pytest

from app.modal_functions.video_processing import (
    _build_simple_ffmpeg_cmd,
    _build_speed_change_ffmpeg_cmd,
)

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")

pytestmark = pytest.mark.skipif(
    not (FFMPEG and FFPROBE), reason="ffmpeg/ffprobe not on PATH"
)

SOURCE_FPS = 50
TARGET_FPS = 30
SOURCE_DURATION_S = 2.0  # -> 100 source frames at 50fps


def _probe_duration(path):
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "json", path],
        capture_output=True, text=True, check=True,
    )
    return float(json.loads(out.stdout)["format"]["duration"])


def _probe_r_frame_rate(path):
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=r_frame_rate", "-of", "json", path],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)["streams"][0]["r_frame_rate"]


def _grid_emitted_indices(source_frame_count, original_fps, target_fps):
    """Same integer-cadence resampler recommended in
    test_t8280_fps_export_choice.py: emit frame_num_rel when its target-grid
    index advances. Reimplemented here (not imported) so this fixture doesn't
    depend on the not-yet-existing production helper -- it independently
    derives the expected down-sampled frame set from the documented formula."""
    emitted = []
    last_grid_idx = -1
    for frame_num_rel in range(source_frame_count):
        grid_idx = int(frame_num_rel * target_fps / original_fps)
        if grid_idx > last_grid_idx:
            emitted.append(frame_num_rel)
            last_grid_idx = grid_idx
    return emitted


@pytest.fixture
def source_and_downsampled_frames(tmp_path):
    """A real 50fps, 2s synthetic source video, extracted to a FULL PNG
    sequence (one per source frame, same as Tbug49p's fixture), then
    down-sampled to a NEW sequentially-numbered PNG sequence containing only
    the grid-emitted frames -- simulating what the fixed read loop's
    enhance()+imwrite() gate would produce."""
    source_path = str(tmp_path / "source.mp4")
    subprocess.run(
        [FFMPEG, "-y", "-f", "lavfi",
         "-i", f"testsrc=duration={SOURCE_DURATION_S}:rate={SOURCE_FPS}:size=320x240",
         "-pix_fmt", "yuv420p", source_path],
        capture_output=True, text=True, check=True,
    )
    assert abs(_probe_duration(source_path) - SOURCE_DURATION_S) < 0.05

    full_frames_dir = tmp_path / "full_frames"
    full_frames_dir.mkdir()
    full_pattern = str(full_frames_dir / "frame_%06d.png")
    subprocess.run(
        [FFMPEG, "-y", "-i", source_path, full_pattern],
        capture_output=True, text=True, check=True,
    )
    full_frame_paths = sorted(full_frames_dir.glob("*.png"))
    source_frame_count = len(full_frame_paths)
    assert source_frame_count == round(SOURCE_DURATION_S * SOURCE_FPS)

    emitted_indices = _grid_emitted_indices(source_frame_count, SOURCE_FPS, TARGET_FPS)

    downsampled_dir = tmp_path / "downsampled_frames"
    downsampled_dir.mkdir()
    downsampled_pattern = str(downsampled_dir / "frame_%06d.png")
    for out_idx, src_idx in enumerate(emitted_indices):
        src_path = full_frame_paths[src_idx]
        dst_path = downsampled_dir / f"frame_{out_idx:06d}.png"
        shutil.copyfile(src_path, dst_path)

    emitted_count = len(emitted_indices)
    return source_path, downsampled_pattern, emitted_count, source_frame_count


class TestDownsampleRealFfmpegRoundTrip:
    def test_emitted_count_is_less_than_source_frame_count(self, source_and_downsampled_frames):
        """Structural proof the GPU-savings claim is real: fewer frames were
        constructed for enhance()+imwrite than exist in the source -- this is
        the ~40% GPU reduction the design doc's Stage 1 targets."""
        _, _, emitted_count, source_frame_count = source_and_downsampled_frames
        assert emitted_count == round(SOURCE_DURATION_S * TARGET_FPS) == 60
        assert emitted_count < source_frame_count

    def test_downsampled_simple_encode_preserves_source_duration(self, tmp_path, source_and_downsampled_frames):
        """The down-sample call shape (input_fps=TARGET_FPS, matching the fixed
        read loop's png cadence) must round-trip through ffmpeg to the SOURCE's
        real duration, not stretched or compressed -- proving the fps math
        still round-trips correctly after down-sampling at read time."""
        source_path, downsampled_pattern, emitted_count, _ = source_and_downsampled_frames
        output_path = str(tmp_path / "output_downsampled.mp4")

        cmd = _build_simple_ffmpeg_cmd(
            downsampled_pattern, source_path, output_path,
            fps=TARGET_FPS, has_audio=False, audio_start_time=0,
            frame_count=emitted_count,
            input_fps=TARGET_FPS,  # down-sample call shape: pngs are AT target cadence
        )
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr

        actual_duration = _probe_duration(output_path)
        # +/- 1 frame at 30fps == +/- 0.0333s; allow a little ffmpeg encode slop.
        assert abs(actual_duration - SOURCE_DURATION_S) < (1.0 / TARGET_FPS) + 0.05, (
            f"expected ~{SOURCE_DURATION_S}s (source duration preserved through "
            f"down-sample), got {actual_duration:.3f}s"
        )

        r_frame_rate = _probe_r_frame_rate(output_path)
        num, den = (int(x) for x in r_frame_rate.split("/"))
        assert abs(num / den - TARGET_FPS) < 0.01, f"expected {TARGET_FPS}fps output, got {r_frame_rate}"

    def test_downsampled_speed_change_branch_preserves_sped_up_duration(self, tmp_path, source_and_downsampled_frames):
        """Highest-risk interaction per the design doc's Risks section: the
        speed-change PTS math against a down-sampled (target-cadence) png
        sequence. A 0.5x segment over the full 2s down-sampled clip must
        produce ~4s of output (half speed doubles duration) -- proving the
        PTS/duration math is keyed off the down-sampled cadence consistently,
        not a mix of source and target fps."""
        source_path, downsampled_pattern, emitted_count, _ = source_and_downsampled_frames
        output_path = str(tmp_path / "output_speed_change.mp4")

        # Whole-clip segment at 0.5x, referencing the DOWN-SAMPLED cadence's own
        # duration (emitted_count / TARGET_FPS == SOURCE_DURATION_S).
        clip_duration = emitted_count / TARGET_FPS
        filter_complex = (
            f"[0:v]trim=start=0:end={clip_duration},setpts=(PTS-STARTPTS)/0.5[v0];"
            "[v0]concat=n=1:v=1:a=0[outv]"
        )
        cmd = _build_speed_change_ffmpeg_cmd(
            downsampled_pattern, source_path, output_path,
            filter_complex, has_audio_output=False,
            original_fps=TARGET_FPS,  # down-sample call shape: the "original_fps" arg here
                                       # is the ACTUAL png cadence post-down-sample (target fps),
                                       # per the design doc's highest-risk-interaction note.
            fps=TARGET_FPS,
        )
        result = subprocess.run(cmd, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr

        actual_duration = _probe_duration(output_path)
        expected_duration = clip_duration / 0.5  # 0.5x speed doubles duration
        assert abs(actual_duration - expected_duration) < 0.15, (
            f"expected ~{expected_duration:.3f}s (0.5x speed over "
            f"{clip_duration:.3f}s down-sampled clip), got {actual_duration:.3f}s"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
