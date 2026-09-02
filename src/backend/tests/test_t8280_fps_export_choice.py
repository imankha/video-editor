"""
T8280 -- 30fps export choice + fps-based pricing for high-fps sources (Option B
scope: ship the cost-saving 30fps down-sample choice; do NOT implement true
native-fps delivery). Design: docs/plans/tasks/T8280-design.md.

Mirrors the precedent set by test_tbug49p_export_fps.py: these are UNIT tests
pinning ffmpeg command argument shapes and pure-function arithmetic, written
against code that does not exist yet -- they are expected to FAIL (mostly via
ImportError) until the Implementor lands Stage 1 (read-loop frame-skip) and
Stage 2 (credit formula).

Scope notes:
- Stage 1 (video_processing.py read-loop grid-emission skip) is inline in the
  `process_clips_ai` Modal generator function and not directly unit-testable
  without extraction. RECOMMENDATION FOR THE IMPLEMENTOR: extract the grid-
  membership decision into a small pure helper, e.g.

      def _should_emit_downsampled_frame(frame_num_rel: int, original_fps: float,
                                          target_fps: float, last_emitted_grid_idx: int) -> tuple[bool, int]:
          '''Integer-cadence resampler: emit when the frame's target-grid index
          advances past last_emitted_grid_idx. frame_num_rel is 0-based within
          the clip's own trim window (start_frame subtracted already).'''
          grid_idx = int(frame_num_rel * target_fps / original_fps)
          if grid_idx > last_emitted_grid_idx:
              return True, grid_idx
          return False, last_emitted_grid_idx

  mirroring Tbug49p's extraction of `_build_speed_change_ffmpeg_cmd` "specifically
  so this was testable". `TestDownsampledFrameGridEmission` below is written
  against this exact shape (importing `_should_emit_downsampled_frame` from
  `app.modal_functions.video_processing`) -- if the Implementor names the helper
  differently, this class's import will need updating, but the GRID MATH it
  pins (which source-frame indices survive a 50->30 / 60->30 down-sample) is
  the load-bearing part and should not change.
- The ffmpeg-builder call-SHAPE tests (`TestDownsampleCallerShapes`) are written
  at a level that's directly testable today without any extraction: they prove
  that in the down-sample scenario the caller passes `input_fps=fps` (30) and a
  REDUCED frame_count to `_build_simple_ffmpeg_cmd` / `_build_speed_change_ffmpeg_cmd`,
  by calling those builders directly with the values Stage 1 is expected to
  compute (not by driving the full Modal generator, which needs a GPU/cv2
  environment this suite doesn't have). These tests pass against the EXISTING
  (unmodified) builder functions -- they encode the call-shape contract the
  Implementor's new caller code must satisfy, so they're a spec, not a
  regression pin. They are included here (not skipped) because the SHAPES are
  correct today; what's missing is the CALLER wiring, which the repro test
  file drives end-to-end through real ffmpeg instead.
"""

import math

import pytest

from app.modal_functions.video_processing import (
    _build_simple_ffmpeg_cmd,
    _build_speed_change_ffmpeg_cmd,
)


def _last_input_index(cmd):
    """Index of the LAST -i flag's value -- output-only flags (-r, output path)
    must appear after this."""
    return max(i for i, arg in enumerate(cmd) if arg == "-i")


class TestDownsampledFrameGridEmission:
    """Pins the integer-cadence resampler that decides which SOURCE frames get
    enhance()+imwrite() when down-sampling (target fps < source fps). This is
    the actual GPU-cost win (Stage 1) -- skipping enhance() for frames that
    would be discarded by ffmpeg's -r anyway, but BEFORE paying for them.

    Expected to fail with ImportError until the Implementor extracts
    `_should_emit_downsampled_frame` (or equivalent) per the module docstring's
    recommendation.
    """

    def test_50fps_to_30fps_emits_expected_grid_indices(self):
        """A 50fps source down-sampled to 30fps target: over 100 source frames
        (2s clip), verify the emitted COUNT matches round(2 * 30) = 60, and the
        emitted frames are monotonically increasing grid positions (no source
        frame emitted twice)."""
        from app.modal_functions.video_processing import _should_emit_downsampled_frame

        original_fps = 50.0
        target_fps = 30.0
        source_frame_count = 100  # 2 seconds @ 50fps

        emitted = []
        last_grid_idx = -1
        for frame_num_rel in range(source_frame_count):
            should_emit, last_grid_idx = _should_emit_downsampled_frame(
                frame_num_rel, original_fps, target_fps, last_grid_idx
            )
            if should_emit:
                emitted.append(frame_num_rel)

        assert len(emitted) == round(source_frame_count * target_fps / original_fps) == 60
        assert emitted == sorted(set(emitted)), "no duplicate/out-of-order emission"
        assert emitted[0] == 0, "first source frame is always on the grid"

    def test_60fps_to_30fps_emits_half_the_frames(self):
        from app.modal_functions.video_processing import _should_emit_downsampled_frame

        original_fps = 60.0
        target_fps = 30.0
        source_frame_count = 120  # 2 seconds @ 60fps

        emitted = []
        last_grid_idx = -1
        for frame_num_rel in range(source_frame_count):
            should_emit, last_grid_idx = _should_emit_downsampled_frame(
                frame_num_rel, original_fps, target_fps, last_grid_idx
            )
            if should_emit:
                emitted.append(frame_num_rel)

        assert len(emitted) == 60, "60fps->30fps must emit exactly every other source frame"
        assert emitted == list(range(0, 120, 2))

    def test_native_no_downsample_emits_every_frame(self):
        """When target >= source (native / no-op gate), every frame must be
        emitted -- this is the 'gated single path, native = no-op gate' design
        goal (design doc section 8), not a parallel code path."""
        from app.modal_functions.video_processing import _should_emit_downsampled_frame

        original_fps = 30.0
        target_fps = 30.0
        source_frame_count = 60

        emitted = []
        last_grid_idx = -1
        for frame_num_rel in range(source_frame_count):
            should_emit, last_grid_idx = _should_emit_downsampled_frame(
                frame_num_rel, original_fps, target_fps, last_grid_idx
            )
            if should_emit:
                emitted.append(frame_num_rel)

        assert len(emitted) == source_frame_count, "native path must not skip any frame"
        assert emitted == list(range(source_frame_count))

    def test_sub_30_source_target_still_emits_every_frame(self):
        """A 25fps source with a 30 target (target > source): still a no-op
        gate per design (sub-30 sources are unaffected by this task -- you
        cannot skip frames you do not have)."""
        from app.modal_functions.video_processing import _should_emit_downsampled_frame

        original_fps = 25.0
        target_fps = 30.0
        source_frame_count = 50

        emitted = []
        last_grid_idx = -1
        for frame_num_rel in range(source_frame_count):
            should_emit, last_grid_idx = _should_emit_downsampled_frame(
                frame_num_rel, original_fps, target_fps, last_grid_idx
            )
            if should_emit:
                emitted.append(frame_num_rel)

        assert len(emitted) == source_frame_count


class TestDownsampleCallerShapes:
    """Proves the ffmpeg-builder CALL SHAPE the Stage 1 caller must produce in
    the down-sample case: input_fps=target_fps (pngs are now at target
    cadence), and frame_count reflecting the REDUCED (emitted) count, not the
    source frame count. These call the existing builder functions directly
    (no extraction needed) -- they encode the contract the Implementor's new
    caller code in process_clips_ai must satisfy.
    """

    def test_simple_cmd_downsample_declares_input_fps_as_target_not_source(self):
        """Once frames are down-sampled at read time, the pngs ARE at 30fps
        cadence -- input_fps must be the TARGET (30), not original_fps (50)."""
        emitted_frame_count = 60  # 50fps source, 2s clip, down-sampled to 30fps
        cmd = _build_simple_ffmpeg_cmd(
            "frame_%06d.png", "source.mp4", "out.mp4",
            fps=30, has_audio=False, audio_start_time=0,
            frame_count=emitted_frame_count,
            input_fps=30,  # down-sample call shape: input_fps == target fps
        )
        assert cmd[cmd.index("-framerate") + 1] == "30"
        assert cmd[cmd.index("-r") + 1] == "30"
        assert cmd.index("-r") > _last_input_index(cmd)

    def test_simple_cmd_downsample_audio_duration_uses_reduced_frame_count(self):
        """-t must reflect the REDUCED emitted-frame count over the target
        fps, i.e. real elapsed seconds of the down-sampled sequence (60/30 =
        2.0s, matching the original clip duration -- proving duration is
        preserved even though fewer frames were captured)."""
        emitted_frame_count = 60
        cmd = _build_simple_ffmpeg_cmd(
            "frame_%06d.png", "source.mp4", "out.mp4",
            fps=30, has_audio=True, audio_start_time=0,
            frame_count=emitted_frame_count,
            input_fps=30,
        )
        t_value = float(cmd[cmd.index("-t") + 1])
        assert abs(t_value - 2.0) < 1e-9

    def test_speed_change_cmd_downsample_uses_target_fps_as_original_fps_arg(self):
        """In the down-sample case, `_build_speed_change_ffmpeg_cmd`'s
        `original_fps` param (which drives -framerate for the PNG input) must
        be called with the TARGET fps (30), since that's the actual cadence of
        the emitted png sequence post-down-sample -- NOT the true source fps
        (50/60). This is the highest-risk call site per the design doc's Risks
        section (PTS math previously keyed off true original_fps)."""
        filter_complex = (
            "[0:v]trim=start=0:end=1,setpts=(PTS-STARTPTS)/2.0[v0];"
            "[v0]concat=n=1:v=1:a=0[outv]"
        )
        cmd = _build_speed_change_ffmpeg_cmd(
            "frame_%06d.png", "scratch.mp4", "clip_out.mp4",
            filter_complex, has_audio_output=False,
            original_fps=30,  # down-sample call shape: pass target, not true source
            fps=30,
        )
        assert cmd[cmd.index("-framerate") + 1] == "30"
        assert cmd[cmd.index("-r") + 1] == "30"


class TestComputeExportCredits:
    """Credit formula (Stage 2): shared pure helper replacing the duplicated
    inline `math.ceil(video_seconds)` at framing.py:493 and multi_clip.py:2155.
    Design doc Q1: `ceil(video_seconds * max(1, source_fps/target_fps))`.

    Named args below use `output_fps` as the SECOND positional/keyword arg per
    the ground truth's proposed signature `compute_export_credits(video_seconds,
    output_fps=30)` -- NOTE this is actually parameterizing on the RATIO the
    ground truth describes as `max(1, output_fps/30)`, i.e. `output_fps` here
    plays the role of "the fps this render actually costs GPU-time as if it
    were" (source_fps when down-sample is NOT applied, i.e. native pricing).
    For the Option-B-only call sites in this task, both call sites always pass
    target_fps=30, which is exactly `compute_export_credits(seconds, 30)` --
    the identity/regression case.
    """

    def test_matches_todays_ceil_for_target_fps_30(self):
        """Both live call sites (framing.py, multi_clip.py) pass target_fps=30
        for the whole of Option B's scope -- this must be BYTE-IDENTICAL to
        today's bare `math.ceil(video_seconds)` for every existing test."""
        from app.highlight_transform import compute_export_credits

        cases = [0, 0.001, 1, 1.5, 9.999, 10, 17.26, 28.77, 100.0001]
        for seconds in cases:
            assert compute_export_credits(seconds, 30) == (
                math.ceil(seconds) if seconds > 0 else 0
            ), f"mismatch for {seconds}s"

    def test_zero_or_negative_seconds_returns_zero(self):
        from app.highlight_transform import compute_export_credits

        assert compute_export_credits(0, 30) == 0
        assert compute_export_credits(-5, 30) == 0

    def test_general_formula_scales_for_a_hypothetical_non_30_output_fps(self):
        """UNREACHABLE via any live call site in Option B's scope (no native
        choice ships), but the pure function's formula must be correct per the
        design doc's Q1 resolution -- it's the seed for a future native-
        delivery task. 10s at 50fps 'costs' as if scaled by 50/30."""
        from app.highlight_transform import compute_export_credits

        assert compute_export_credits(10, 50) == math.ceil(10 * 50 / 30) == 17

    def test_60fps_output_scales_by_exactly_2x(self):
        from app.highlight_transform import compute_export_credits

        assert compute_export_credits(10, 60) == math.ceil(10 * 60 / 30) == 20

    def test_sub_30_output_fps_clamps_to_1x_never_a_discount(self):
        """max(1, ...) clamp: a sub-30 output_fps (e.g. 25) must NEVER produce
        a price below the flat ceil(seconds) -- there is no GPU-cost discount
        for sub-30 sources (design doc Q3: 'you cannot skip frames you do not
        have')."""
        from app.highlight_transform import compute_export_credits

        assert compute_export_credits(10, 25) == math.ceil(10 * 1) == 10
        assert compute_export_credits(17.26, 25) == math.ceil(17.26)


class TestHighFpsThreshold:
    """Q3: a single named constant shared by frontend/backend, HIGH_FPS_THRESHOLD
    = 31 -- strictly excludes 29.97 (the fleet majority) while catching genuine
    high-fps sources (50/60fps)."""

    def test_threshold_is_31(self):
        from app.highlight_transform import HIGH_FPS_THRESHOLD

        assert HIGH_FPS_THRESHOLD == 31

    def test_2997_is_below_threshold(self):
        from app.highlight_transform import HIGH_FPS_THRESHOLD

        assert 29.97 < HIGH_FPS_THRESHOLD

    def test_50_and_60_are_at_or_above_threshold(self):
        from app.highlight_transform import HIGH_FPS_THRESHOLD

        assert 50 >= HIGH_FPS_THRESHOLD
        assert 60 >= HIGH_FPS_THRESHOLD


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
