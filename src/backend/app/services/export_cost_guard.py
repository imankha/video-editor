"""Preflight GPU-cost estimate + budget guard for Modal framing/upscale exports (T11320,
calibrated T11370).

Bug 58p (prod, 2026-09-25): a user exported 14 clips at full 1920x1080 (no crop reduction,
16:9) four separate times. Each attempt ran Modal's ``process_clips_ai`` for the full hard
``timeout=3600`` before being killed with ``TIMEOUT``, with zero feedback to the user (credits
were auto-refunded each time, so this is purely a wasted-time/trust problem). Nothing checked,
before dispatch, whether the GPU work could plausibly finish inside the timeout budget.

This module estimates GPU-seconds BEFORE dispatch and rejects an export that cannot plausibly
finish inside the Modal timeout budget, so the user gets an immediate, structured rejection they
can act on (crop in / split the batch -- see T11330) instead of an hour of silence.

Cost model (deliberately conservative -- a false rejection just tells the user to crop in or
split; a false acceptance repeats Bug 58p):

- Real-ESRGAN GAN cost scales LINEARLY with the crop's INPUT pixel count (confirmed by T11370's
  real Modal staging calibration, not just assumed -- see below). It does NOT scale with the
  enlargement factor (``video_processing.py`` ``_upscale_crop`` docstring, ~:1328).
- ``per_frame_cost(crop_w, crop_h, target_w, target_h) = per_frame_overhead(target_w, target_h)
  + SLOPE_SECONDS_PER_CROP_PIXEL * crop_w * crop_h``. The crop-pixel SLOPE is a single constant
  (target-independent -- confirmed below); the OVERHEAD (fixed per-frame cost: decode, PNG
  write, resize -- everything IN THE LOOP that does NOT scale with crop size) depends on the
  OUTPUT TARGET resolution, not the crop, which is why ``target_w``/``target_h`` are now
  required arguments. Concat/upload/model-load are separate, ONE-TIME-per-job costs (not
  per-frame) -- see ``PER_CLIP_OVERHEAD_SECONDS``/``PER_JOB_OVERHEAD_SECONDS`` below.
- This per-frame formula alone is NOT the whole cost: a Reviewer catch (2026-10-02) found it only
  models in-loop GAN cost, leaving out measured fixed per-clip (extract/encode) and per-job
  (cold start/model load/concat/upload) costs that the OLD pre-T11370 formula's ~15-30%
  systematic overestimate had accidentally been absorbing. ``PER_CLIP_OVERHEAD_SECONDS`` and
  ``PER_JOB_OVERHEAD_SECONDS`` (added in ``estimate_export_cost``, not inside ``per_frame_cost``
  itself) close that gap -- see their own docstrings for the measured data behind them.

T11370 calibration (2026-10-02, real Modal staging dispatch, 3 jobs / 12 measured points,
`src/backend/experiments/t11370_cost_calibration.py` +
`src/backend/experiments/t11370_results/*.jsonl`):

- Per-clip in-loop GAN rate was isolated from fixed per-job overhead (cold start, model load,
  extract/seek, encode) by timestamping every Modal-streamed progress item and fitting
  wall-clock against emitted frame number -- NOT total wall-clock / frame-count (which is what
  the original single-point E6 benchmark did). E6's 0.681 s/frame figure runs noticeably higher
  than the isolated in-loop rate measured here (0.529-0.648 s/frame at the same 540x960 crop,
  depending on target); the EXACT cause of that gap is not established (E6 predates T8270's
  staging/prod app split and may have run a different code path or host) -- don't restate a
  specific mechanism (e.g. "X seconds of cold start") without re-deriving it from E6's own raw
  data, which this calibration did not do.
- The crop-pixel SLOPE agreed within ~1% across two independently-tested target resolutions
  (job A at 810x1440: slope=0.8663e-6 s/frame/px, R2=0.9999; job B at 2560x1440:
  slope=0.8627e-6, R2=1.0000; job C, a same-target replicate in a fresh container:
  slope=0.8589e-6, R2=0.9997) -- this is the evidence the crop-pixel scaling really is linear
  and target-independent, not just an assumption.
- The OVERHEAD differed by target resolution: 0.0817 s/frame pooled at 810x1440 (9:16 default)
  vs 0.2004 s/frame pooled at 2560x1440 (``VIDEO_MAX_WIDTH``x``VIDEO_MAX_HEIGHT`` -- the hard
  ceiling ``calculate_multi_clip_resolution`` can ever produce, so that END of the range is a
  MEASURED point, not extrapolation). ``OVERHEAD_INTERCEPT``/``OVERHEAD_PER_TARGET_PIXEL`` fit a
  line through these two real points. The CEILING (2560x1440) is therefore interpolation-safe for
  every real target; the FLOOR is not -- a target below the smaller anchor (1,166,400 px, which
  happens whenever the export's smallest crop is narrower than ~202px at 9:16 or ~360px at 16:9)
  extrapolates the line downward, a Reviewer-caught correction to an earlier, overly broad claim
  here. The extrapolation's impact is small (at most ~0.055 s/frame of under-prediction at the
  floor) and this 2-point fit for the TARGET-resolution dependence is overall weaker evidence than
  the crop-pixel slope (3 jobs, 12 points, R2>0.998 each) -- a 3rd target-resolution anchor would
  strengthen it; flagged in ``.claude/knowledge/modal-gpu.md``.
- Frame count per clip = the TRIMMED source seconds * target_fps. Modal's ``process_clips_ai``
  runs the GAN only over the trim range (``video_processing.py`` ~:2984-2990, start/end frame
  from the trim range); slow-mo/speed segments are applied AFTER the GAN via ``setpts`` and add
  NO GAN frames -- so we count trimmed SOURCE length (``get_trim_range``), never the raw clip
  length and never ``get_output_duration`` (which counts speed expansion that costs no GAN).

The structured rejection shape (``ExportBudgetExceeded.estimate.to_error_detail()``) is a stable
contract T11330's popup builds on -- see that method's docstring for the field list.

T11350 note: when the GAN-skip gate (``GAN_MIN_ENLARGE``) is enabled, some crops will skip the
GAN and cost far less. The formula is written so that only ``per_frame_cost`` needs to learn a
per-clip skip flag then -- callers and the budget check stay unchanged.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# --- T11370 real-Modal-staging calibration (see module docstring for full provenance) -------
# Crop-pixel slope: target-independent (agreed within ~1% across 2 target resolutions + a
# replicate), pooled from all 3 jobs' individual fits (0.8663e-6, 0.8627e-6, 0.8589e-6 -> avg).
SLOPE_SECONDS_PER_CROP_PIXEL = 0.863e-6

# Fixed per-frame overhead (decode/PNG-write/resize/concat -- does NOT scale with crop size),
# fit as a line through the two MEASURED target-resolution anchors:
#   810x1440  (1,166,400 px) -> 0.0817 s/frame  (9:16 default-scale target)
#   2560x1440 (3,686,400 px) -> 0.2004 s/frame  (VIDEO_MAX_WIDTH x VIDEO_MAX_HEIGHT, the hard
#                                                 ceiling -- every real target falls <= this)
OVERHEAD_INTERCEPT = 0.0268  # s/frame at target_px -> 0 (extrapolated floor below the smaller
                              # measured anchor, 1,166,400 px -- NOT interpolation there, unlike
                              # the ceiling; a Reviewer-caught correction, see module docstring)
OVERHEAD_PER_TARGET_PIXEL = 4.71e-8  # s/frame per output-target pixel

# Fixed costs the in-loop per-frame formula above does NOT capture, because they happen once
# (per clip, or once per whole export) rather than scaling with frame count: source extract/seek
# before the GAN loop starts, ffmpeg encode/cleanup after it ends (PER-CLIP), and model load +
# concat + result upload (PER-JOB, paid once regardless of clip count). A Reviewer catch
# (2026-10-02): the pre-T11370 formula's systematic ~15-30% OVERESTIMATE at mid/large crops was
# accidentally covering these costs; the T11370 recalibration removed that accidental buffer by
# being more accurate, so these must now be modeled explicitly rather than left to the 20% budget
# margin alone -- the guard's whole purpose is avoiding a false-acceptance (Bug 58p), so an
# unmodeled fixed cost eating into that margin is exactly the risk this guard exists to close.
# Values are measured maxima + a safety margin (T11370 data, `t11370_results/*.jsonl`): per-clip
# extract+encode ranged 2.4-8.8s across all 12 measured clips (job B's c1280x720 was the max);
# per-job model-load+concat+upload-to-complete ranged ~4.7-8.9s. Cold start (dispatch-to-first-
# streamed-item) is a separate, much larger and more variable cost (5.5-31.8s measured) that is
# folded into PER_JOB_OVERHEAD_SECONDS too, conservatively, since Modal's function `timeout`
# bounds the whole invocation including any cold start the instance pays.
PER_CLIP_OVERHEAD_SECONDS = 10.0
PER_JOB_OVERHEAD_SECONDS = 40.0


def _overhead_seconds_per_frame(target_width: int, target_height: int) -> float:
    """Fixed per-frame overhead for a given OUTPUT target resolution (see module docstring)."""
    if not target_width or not target_height or target_width <= 0 or target_height <= 0:
        raise ValueError(
            f"_overhead_seconds_per_frame got invalid target dims "
            f"({target_width}x{target_height}); the export target resolution must be positive "
            f"by the time the guard runs"
        )
    return OVERHEAD_INTERCEPT + OVERHEAD_PER_TARGET_PIXEL * (target_width * target_height)

# --- Timeout budget ---------------------------------------------------------
# process_clips_ai runs on a single T4 with no chunking and a hard timeout of
# 3600s (video_processing.py:2782-2789). We reject at 80% of that so slower
# frames / decode overhead / concat still fit under the real ceiling.
MODAL_TIMEOUT_SECONDS = 3600
BUDGET_FRACTION = 0.80
GPU_SECONDS_BUDGET = MODAL_TIMEOUT_SECONDS * BUDGET_FRACTION  # 2880.0


@dataclass(frozen=True)
class ClipCostEstimate:
    """Per-clip contribution to the export's estimated GPU-seconds."""

    clip_index: int
    clip_name: str | None
    frame_count: int
    crop_width: int
    crop_height: int
    estimated_gpu_seconds: float


@dataclass(frozen=True)
class ExportCostEstimate:
    """Whole-export GPU-cost estimate + the budget decision."""

    estimated_gpu_seconds: float
    budget_seconds: float
    modal_timeout_seconds: float
    budget_fraction: float
    over_budget: bool
    # Per-clip contributions, sorted biggest-first so a popup can name the worst offenders.
    per_clip: list[ClipCostEstimate]

    def to_error_detail(self) -> dict[str, Any]:
        """Structured rejection payload for the client (T11330 popup contract).

        Stable fields:
        - ``code``: always ``"export_too_large"`` -- the discriminator T11330 keys on.
        - ``estimated_gpu_seconds`` / ``budget_seconds`` / ``modal_timeout_seconds`` /
          ``budget_fraction``: the numbers behind the decision.
        - ``biggest_contributors``: per-clip breakdown, largest first, so the popup can name
          specific clips ("Clip 3 (1920x1080) alone needs ~X min") and suggest cropping/splitting.
        """
        return {
            "code": "export_too_large",
            "message": (
                f"This export needs an estimated {self.estimated_gpu_seconds:.0f}s of GPU time, "
                f"over the {self.budget_seconds:.0f}s safe limit "
                f"({self.budget_fraction:.0%} of the {self.modal_timeout_seconds:.0f}s cap). "
                f"Crop in tighter or split the batch into fewer clips."
            ),
            "estimated_gpu_seconds": round(self.estimated_gpu_seconds, 1),
            "budget_seconds": self.budget_seconds,
            "modal_timeout_seconds": self.modal_timeout_seconds,
            "budget_fraction": self.budget_fraction,
            "biggest_contributors": [
                {
                    "clip_index": c.clip_index,
                    "clip_name": c.clip_name,
                    "frame_count": c.frame_count,
                    "crop_width": c.crop_width,
                    "crop_height": c.crop_height,
                    "estimated_gpu_seconds": round(c.estimated_gpu_seconds, 1),
                }
                for c in self.per_clip
            ],
        }


class ExportBudgetExceeded(Exception):
    """Raised before dispatch when an export's estimated GPU-seconds exceed the budget.

    Carries the full :class:`ExportCostEstimate` (``.estimate``) so callers can surface the
    structured rejection (``.estimate.to_error_detail()``) rather than a free-text string.
    """

    def __init__(self, estimate: ExportCostEstimate):
        self.estimate = estimate
        # str() is the plain human message (not a dict repr), so a background runner that
        # writes str(e) into export_jobs.error stores something readable (M3).
        super().__init__(estimate.to_error_detail()["message"])


def per_frame_cost(crop_width: int, crop_height: int, target_width: int, target_height: int) -> float:
    """Estimated T4 GPU-seconds to produce ONE emitted frame: a crop-size-scaled GAN cost plus a
    target-resolution-scaled fixed overhead (see module docstring for the T11370 calibration that
    derived both terms). ``target_width``/``target_height`` are the EXPORT'S output resolution
    (``calculate_multi_clip_resolution``'s result), not the crop -- required because the fixed
    per-frame overhead (decode/PNG-write/resize/concat) scales with how big the output frame is,
    not with the crop. Missing/zero/negative dims (crop OR target) are an internal-data bug (crop
    keyframes are always populated and the target is always computed before this runs), so we
    fail loudly rather than guessing a default (No Silent Fallbacks).
    """
    if not crop_width or not crop_height or crop_width <= 0 or crop_height <= 0:
        raise ValueError(
            f"per_frame_cost got invalid crop dims ({crop_width}x{crop_height}); "
            f"crop keyframes must carry positive width/height by dispatch time"
        )
    return (
        _overhead_seconds_per_frame(target_width, target_height)
        + SLOPE_SECONDS_PER_CROP_PIXEL * (crop_width * crop_height)
    )


def estimate_total_gpu_seconds(
    clip_specs: list[tuple[int, int, int]], target_width: int, target_height: int
) -> float:
    """Pure cost function: total estimated GPU-seconds for a list of clips sharing one export
    target resolution.

    Each spec is ``(frame_count, crop_input_width, crop_input_height)``. Returns
    ``sum(frame_count * per_frame_cost(w, h, target_width, target_height))``. No I/O, no Modal --
    unit-testable in isolation.
    """
    return sum(
        frame_count * per_frame_cost(crop_w, crop_h, target_width, target_height)
        for (frame_count, crop_w, crop_h) in clip_specs
    )


def _trimmed_source_seconds(segments: dict | None, raw_duration: float) -> float:
    """Source-time seconds the GAN actually processes: the TRIMMED range, clamped to the raw
    clip length. Modal upscales only ``[trim_start, trim_end]`` of the source; speed segments
    are applied downstream via ``setpts`` and add no GAN frames, so speed expansion is
    deliberately excluded (that is ``get_output_duration``'s job, for progress, not cost).

    An unbounded (``inf``) trim end means "to the end of the clip" -> clamp to ``raw_duration``.
    """
    from app.highlight_transform import get_trim_range

    trim_start, trim_end = get_trim_range(segments)
    end = raw_duration if trim_end == float("inf") else min(trim_end, raw_duration)
    start = min(max(0.0, trim_start), raw_duration)
    return max(0.0, end - start)


def _clip_frame_count(effective_seconds: float, target_fps: int) -> int:
    """Conservative emitted-frame count for the TRIMMED source span. Rounds UP (ceil) -- an
    over-estimate here only tightens the guard. GAN cost tracks EMITTED frames (T8280:
    enhance() runs on the target-fps grid, not every decoded source frame), so target_fps is
    the right multiplier."""
    if not target_fps or target_fps <= 0:
        raise ValueError(f"target_fps must be positive, got {target_fps!r}")
    return max(1, math.ceil(effective_seconds * target_fps))


def _max_crop_dims(crop_keyframes: list[dict[str, Any]]) -> tuple[int, int] | None:
    """Largest crop INPUT box (by area) across a clip's keyframes -- the conservative choice,
    since the crop can change across keyframes and the biggest input costs the most.

    Returns ``None`` when the clip has NO keyframes. That is the un-customized "no crop"
    state: Modal falls back to a smart-center-crop sized from the SOURCE dims (see
    ``video_processing.py`` ~:3034), which this guard cannot bound without probing the source
    -- and the kickoff scopes the guard to keyframe data only, no new data source. The caller
    logs loudly and excludes the clip rather than guessing (see ``estimate_export_cost``).

    Fails loudly (``ValueError``) when a keyframe IS present but lacks a positive width/height
    -- that is genuine internal-data corruption, not a legitimate "no crop" state (No Silent
    Fallbacks)."""
    if not crop_keyframes:
        return None
    best_w = best_h = 0
    best_area = -1
    for kf in crop_keyframes:
        w = kf.get("width")
        h = kf.get("height")
        if not w or not h:
            raise ValueError(f"crop keyframe missing width/height: {kf!r}")
        area = w * h
        if area > best_area:
            best_area = area
            best_w, best_h = round(w), round(h)
    return best_w, best_h


def estimate_export_cost(
    clips: list[dict[str, Any]], target_fps: int, target_width: int, target_height: int
) -> ExportCostEstimate:
    """Estimate the whole export's GPU-seconds from clip dicts + target fps + the export's output
    target resolution (``calculate_multi_clip_resolution``'s result -- the fixed per-frame
    overhead scales with this, see module docstring).

    ``clips`` entries use the internal ``clips_data`` shape: ``cropKeyframes`` (list of
    ``{width, height, ...}``), ``duration`` (seconds), ``clipIndex``, ``clipName``. Per clip we
    take the largest crop input box and the ceil'd emitted-frame count -- both conservative.
    """
    per_clip: list[ClipCostEstimate] = []
    for i, clip in enumerate(clips):
        clip_index = clip.get("clipIndex", i)
        clip_name = clip.get("clipName") or clip.get("fileName")
        dims = _max_crop_dims(clip.get("cropKeyframes") or [])
        if dims is None:
            # No crop keyframes -> Modal smart-center-crops from source dims, which we can't
            # bound here (keyframes-only scope). Log loudly and skip rather than guess; the
            # guard therefore cannot catch a full-frame *no-crop* batch (documented gap).
            logger.warning(
                "[ExportGuard] clip %s (%r) has no crop keyframes -- excluded from the GPU-cost "
                "estimate (smart-center-crop path is unbounded without a source-dims probe).",
                clip_index, clip_name,
            )
            continue
        crop_w, crop_h = dims
        # Fail loud on a missing/zero/negative raw duration -- a real clip has positive length;
        # silently treating it as 1 frame would under-estimate (No Silent Fallbacks).
        raw_duration = clip.get("duration")
        if raw_duration is None or raw_duration <= 0:
            raise ValueError(
                f"clip {clip_index} has invalid duration {raw_duration!r}; "
                f"a real clip must carry a positive length by dispatch time"
            )
        effective_seconds = _trimmed_source_seconds(clip.get("segments"), raw_duration)
        frame_count = _clip_frame_count(effective_seconds, target_fps)
        # Round each clip UP to whole GPU-seconds -- conservative, tidy reporting. Includes
        # PER_CLIP_OVERHEAD_SECONDS (extract/seek + encode/cleanup, measured fixed costs the
        # in-loop per-frame rate doesn't capture -- see module docstring).
        clip_seconds = math.ceil(
            frame_count * per_frame_cost(crop_w, crop_h, target_width, target_height)
            + PER_CLIP_OVERHEAD_SECONDS
        )
        per_clip.append(
            ClipCostEstimate(
                clip_index=clip_index,
                clip_name=clip_name,
                frame_count=frame_count,
                crop_width=crop_w,
                crop_height=crop_h,
                estimated_gpu_seconds=float(clip_seconds),
            )
        )

    per_clip.sort(key=lambda c: c.estimated_gpu_seconds, reverse=True)
    # PER_JOB_OVERHEAD_SECONDS (cold start + model load + concat + upload) is paid ONCE per
    # export, not per clip -- added to the total only, never folded into a per-clip figure (that
    # would double-count it across clips and wrongly inflate the "biggest contributors" popup).
    total = sum(c.estimated_gpu_seconds for c in per_clip)
    if per_clip:
        total += PER_JOB_OVERHEAD_SECONDS

    return ExportCostEstimate(
        estimated_gpu_seconds=total,
        budget_seconds=float(GPU_SECONDS_BUDGET),
        modal_timeout_seconds=float(MODAL_TIMEOUT_SECONDS),
        budget_fraction=BUDGET_FRACTION,
        over_budget=total > GPU_SECONDS_BUDGET,
        per_clip=per_clip,
    )


def enforce_export_budget(
    clips: list[dict[str, Any]], target_fps: int, target_width: int, target_height: int
) -> ExportCostEstimate:
    """Estimate the export's GPU cost and raise :class:`ExportBudgetExceeded` if over budget.

    ``target_width``/``target_height`` is the export's OUTPUT resolution (pass
    ``calculate_multi_clip_resolution``'s result) -- the fixed per-frame overhead scales with it
    (T11370 calibration, see module docstring).

    Returns the estimate when within budget (callers may log it). Call this BEFORE dispatching
    to ``call_modal_clips_ai`` so an over-budget export is rejected immediately instead of after
    the full Modal timeout.
    """
    estimate = estimate_export_cost(clips, target_fps, target_width, target_height)
    if estimate.over_budget:
        logger.warning(
            "[ExportGuard] Rejecting over-budget export: "
            "estimated=%.0fs budget=%.0fs clips=%d biggest=%s",
            estimate.estimated_gpu_seconds,
            estimate.budget_seconds,
            len(estimate.per_clip),
            estimate.per_clip[0].clip_name if estimate.per_clip else None,
        )
        raise ExportBudgetExceeded(estimate)
    logger.info(
        "[ExportGuard] Export within budget: estimated=%.0fs budget=%.0fs clips=%d",
        estimate.estimated_gpu_seconds,
        estimate.budget_seconds,
        len(estimate.per_clip),
    )
    return estimate
