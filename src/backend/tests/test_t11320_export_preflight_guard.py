"""T11320: preflight export-size guard for Modal multi-clip / single-clip exports.

Bug 58p (prod, 2026-09-25): a user exported 14 clips at full 1920x1080 (no crop reduction,
16:9) four times; each ran Modal's process_clips_ai for the full timeout=3600 before being
killed, with zero feedback. The guard estimates GPU-seconds BEFORE dispatch and rejects an
export that cannot plausibly finish inside the timeout budget.

Two layers of proof:
- Pure unit tests of the cost model + budget decision + structured rejection shape.
- Integration tests through `multi_clip._export_clips` (the shared path BOTH multi-clip and
  single-clip /render use) proving a Bug-58p-shaped export is rejected BEFORE
  `call_modal_clips_ai` is ever invoked, while a normal small export dispatches unaffected.
"""

import math

import pytest

from app.routers.export import multi_clip as mc
from app.services.export_cost_guard import (
    ANCHOR_CROP_PIXELS,
    ANCHOR_SECONDS_PER_FRAME,
    GPU_SECONDS_BUDGET,
    ExportBudgetExceeded,
    enforce_export_budget,
    estimate_export_cost,
    estimate_total_gpu_seconds,
    per_frame_cost,
)


# ----------------------------------------------------------------------------
# Fixtures shaped like the real export inputs (internal clips_data dicts)
# ----------------------------------------------------------------------------
def _full_frame_clip(clip_index: int, duration: float, w: int = 1920, h: int = 1080) -> dict:
    """A clip with a full-source crop (no reduction) -- the Bug 58p shape."""
    return {
        "clipIndex": clip_index,
        "clipName": f"Clip {clip_index}",
        "duration": duration,
        "cropKeyframes": [
            {"frame": 0, "x": 0, "y": 0, "width": w, "height": h},
            {"frame": 1, "x": 0, "y": 0, "width": w, "height": h},
        ],
    }


def _default_916_clip(clip_index: int, duration: float) -> dict:
    """A clip with the CURRENT default 9:16 crop (410x730, T10150) -- a small, normal export."""
    return {
        "clipIndex": clip_index,
        "clipName": f"Clip {clip_index}",
        "duration": duration,
        "cropKeyframes": [
            {"frame": 0, "x": 0, "y": 0, "width": 410, "height": 730},
            {"frame": 1, "x": 0, "y": 0, "width": 410, "height": 730},
        ],
    }


def _bug58p_clips() -> list[dict]:
    # 14 clips, ~79s total of 1920x1080, no crop reduction (full-frame crop), 16:9.
    return [_full_frame_clip(i, duration=79.0 / 14) for i in range(14)]


# ----------------------------------------------------------------------------
# Pure cost-model unit tests
# ----------------------------------------------------------------------------
def test_per_frame_cost_matches_anchor_at_anchor_crop():
    # At exactly the measured anchor crop (540x960) one frame costs the anchor seconds.
    assert per_frame_cost(540, 960) == pytest.approx(ANCHOR_SECONDS_PER_FRAME)


def test_per_frame_cost_scales_with_input_pixels():
    # Doubling area doubles cost (GAN scales with INPUT pixel count).
    base = per_frame_cost(410, 365)
    assert per_frame_cost(820, 365) == pytest.approx(2 * base)
    # A full 1080p crop is (1920*1080)/(540*960) = 4.0x the anchor.
    assert per_frame_cost(1920, 1080) == pytest.approx(
        ANCHOR_SECONDS_PER_FRAME * (1920 * 1080) / ANCHOR_CROP_PIXELS
    )
    assert per_frame_cost(1920, 1080) == pytest.approx(4.0 * ANCHOR_SECONDS_PER_FRAME)


def test_per_frame_cost_rejects_missing_dims():
    # No silent fallback: a missing/zero dim is an internal-data bug, fail loudly.
    for bad in [(0, 365), (205, 0), (None, 365), (205, None), (-5, 365)]:
        with pytest.raises(ValueError):
            per_frame_cost(*bad)


def test_estimate_total_gpu_seconds_is_sum():
    specs = [(30, 205, 365), (60, 410, 730)]
    expected = 30 * per_frame_cost(205, 365) + 60 * per_frame_cost(410, 730)
    assert estimate_total_gpu_seconds(specs) == pytest.approx(expected)


def test_bug58p_estimate_is_over_budget():
    est = estimate_export_cost(_bug58p_clips(), target_fps=30)
    assert est.over_budget is True
    # Sanity: a 14x1080p export is well over the 2880s budget. At the measured anchor
    # a full 1080p frame costs 4x0.681s; 14 clips x ~170 frames each ~= 6.5k GPU-s.
    assert est.estimated_gpu_seconds > GPU_SECONDS_BUDGET
    assert est.estimated_gpu_seconds > 5_000
    # Biggest contributors are sorted largest-first and name the clips.
    assert est.per_clip[0].estimated_gpu_seconds >= est.per_clip[-1].estimated_gpu_seconds
    assert est.per_clip[0].crop_width == 1920


def test_normal_export_is_within_budget():
    # 3 short clips at the default 9:16 crop -- the everyday case.
    clips = [_default_916_clip(i, duration=5.0) for i in range(3)]
    est = estimate_export_cost(clips, target_fps=30)
    assert est.over_budget is False
    assert est.estimated_gpu_seconds < GPU_SECONDS_BUDGET


def test_enforce_budget_raises_structured_for_bug58p():
    with pytest.raises(ExportBudgetExceeded) as ei:
        enforce_export_budget(_bug58p_clips(), target_fps=30)
    detail = ei.value.estimate.to_error_detail()
    assert detail["code"] == "export_too_large"
    assert detail["estimated_gpu_seconds"] > detail["budget_seconds"]
    assert detail["budget_seconds"] == GPU_SECONDS_BUDGET
    assert detail["modal_timeout_seconds"] == 3600
    # Enough structure for T11330 to name specific offenders.
    assert len(detail["biggest_contributors"]) == 14
    top = detail["biggest_contributors"][0]
    assert {"clip_index", "clip_name", "frame_count", "crop_width", "crop_height",
            "estimated_gpu_seconds"} <= set(top.keys())


def test_enforce_budget_passes_normal_export():
    clips = [_default_916_clip(i, duration=5.0) for i in range(3)]
    est = enforce_export_budget(clips, target_fps=30)  # must NOT raise
    assert est.over_budget is False


def test_estimate_fails_loud_on_broken_keyframe_dims():
    # No silent fallback: a keyframe that IS present but lacks width/height is corruption.
    with pytest.raises(ValueError):
        estimate_export_cost(
            [{"clipIndex": 0, "duration": 5.0, "cropKeyframes": [{"x": 0, "y": 0}]}],
            target_fps=30,
        )


def test_empty_keyframes_are_skipped_not_crashed():
    # A clip with NO keyframes is the legitimate "no crop" state (Modal smart-center-crops it).
    # The guard excludes it with a loud log instead of crashing a valid export -- this is what
    # keeps existing empty-keyframe exports (e.g. test_t5600 / test_tbug49p) working.
    clips = [
        {"clipIndex": 0, "duration": 5.0, "cropKeyframes": []},   # skipped (no keyframes)
        _full_frame_clip(1, duration=200.0),                      # counted, huge -> over budget
    ]
    est = estimate_export_cost(clips, target_fps=30)
    assert [c.clip_index for c in est.per_clip] == [1]  # only the keyframed clip is counted
    assert est.over_budget is True


def test_all_empty_keyframes_estimate_is_zero_and_passes():
    # An all-empty-keyframes export estimates 0 (nothing bounded) and is NOT rejected --
    # the guard never blocks a valid no-crop export just because it can't size it.
    est = estimate_export_cost(
        [{"clipIndex": 0, "duration": 5.0, "cropKeyframes": []}], target_fps=30
    )
    assert est.per_clip == []
    assert est.estimated_gpu_seconds == 0
    assert est.over_budget is False


def test_clip_frame_count_rounds_up():
    # 79/14 s * 30 fps = 169.28 -> ceil 170 frames per clip (conservative).
    est = estimate_export_cost([_full_frame_clip(0, duration=79.0 / 14)], target_fps=30)
    assert est.per_clip[0].frame_count == math.ceil((79.0 / 14) * 30)


def _trimmed_clip(clip_index, raw_duration, trim_start, trim_end, w=410, h=730):
    return {
        "clipIndex": clip_index,
        "clipName": f"Clip {clip_index}",
        "duration": raw_duration,
        "segments": {"trimRange": {"start": trim_start, "end": trim_end}},
        "cropKeyframes": [
            {"frame": 0, "x": 0, "y": 0, "width": w, "height": h},
            {"frame": 1, "x": 0, "y": 0, "width": w, "height": h},
        ],
    }


def test_estimate_uses_trimmed_not_raw_duration():
    # A 12s raw clip trimmed to [2,6] (4s): the GAN only processes the 4s trim range, not the
    # full 12s. Frame count must reflect the TRIMMED length. (M1 regression.)
    est = estimate_export_cost([_trimmed_clip(0, raw_duration=12.0, trim_start=2.0, trim_end=6.0)], 30)
    assert est.per_clip[0].frame_count == math.ceil(4.0 * 30)  # 120, from 4s not 12s
    # And NOT the raw-length count that the bug produced.
    assert est.per_clip[0].frame_count != math.ceil(12.0 * 30)


def test_trimmed_batch_not_falsely_rejected():
    # Reviewer's concrete case: 25 clips of 12s raw, each trimmed to 4s (100s effective reel,
    # default 9:16 crop). Real GAN work is the trimmed length -> within budget. Counting the raw
    # 12s (the M1 bug) would push the same normal export over budget and wrongly reject it.
    trimmed = [_trimmed_clip(i, raw_duration=12.0, trim_start=0.0, trim_end=4.0) for i in range(25)]
    assert estimate_export_cost(trimmed, 30).over_budget is False
    raw_counted = [
        {"clipIndex": i, "duration": 12.0,
         "cropKeyframes": [{"width": 410, "height": 730}]}
        for i in range(25)
    ]
    assert estimate_export_cost(raw_counted, 30).over_budget is True  # the bug's behavior


def test_no_segments_uses_full_raw_length():
    # No trim data -> GAN processes the whole clip; use the full raw length.
    est = estimate_export_cost(
        [{"clipIndex": 0, "duration": 10.0, "segments": None,
          "cropKeyframes": [{"width": 410, "height": 730}]}],
        30,
    )
    assert est.per_clip[0].frame_count == math.ceil(10.0 * 30)


def test_zero_or_missing_duration_fails_loud():
    # A zero/missing/negative raw duration is an internal-data bug -- fail loud, do NOT silently
    # under-count as 1 frame (M1 minor).
    for bad in (0, 0.0, -1.0, None):
        with pytest.raises(ValueError):
            estimate_export_cost(
                [{"clipIndex": 0, "duration": bad,
                  "cropKeyframes": [{"width": 410, "height": 730}]}],
                30,
            )


# ----------------------------------------------------------------------------
# Integration: guard fires inside _export_clips BEFORE dispatch
# ----------------------------------------------------------------------------
class _DispatchReached(Exception):
    """Sentinel: raised by the call_modal_clips_ai spy so we stop exactly at dispatch."""


def _make_dispatch_spy():
    calls = []

    async def spy(**kwargs):
        calls.append(kwargs)
        raise _DispatchReached()

    spy.calls = calls
    return spy


class _FakeVid:
    """Readable stand-in so PRE-guard code reaches the upload loop + dispatch (a valid RED)."""

    async def read(self):
        return b"x"

    async def seek(self, *a):
        return None


def _clip_export(mc_mod, clip_index, duration, w, h):
    return mc_mod.ClipExportData(
        clip_index=clip_index,
        crop_keyframes=[
            {"time": 0.0, "x": 0, "y": 0, "width": w, "height": h},
            {"time": duration, "x": 0, "y": 0, "width": w, "height": h},
        ],
        segments=None,
        duration=duration,
        video_file=_FakeVid(),
        clip_name=f"Clip {clip_index}",
    )


@pytest.mark.asyncio
async def test_bug58p_rejected_before_dispatch(monkeypatch):
    """Decisive red-to-green: the Bug-58p shape must be rejected BEFORE call_modal_clips_ai.

    Pre-guard this FAILS: dispatch is reached (spy raises _DispatchReached, spy.calls != []).
    Post-guard it passes: the guard raises before the upload loop, so the spy is never called.
    """
    spy = _make_dispatch_spy()
    monkeypatch.setattr(mc, "modal_enabled", lambda: True)
    monkeypatch.setattr(mc, "call_modal_clips_ai", spy)
    monkeypatch.setattr(mc, "upload_bytes_to_r2", lambda user_id, key, content: True)

    export_id = "exp-t11320-bug58p"
    clips = [_clip_export(mc, i, duration=79.0 / 14, w=1920, h=1080) for i in range(14)]

    with pytest.raises(ExportBudgetExceeded) as ei:
        await mc._export_clips(
            export_id=export_id,
            clips=clips,
            aspect_ratio="16:9",
            transition={"type": "cut", "duration": 0.0},
            include_audio=False,
            target_fps=30,
            export_mode="quality",
            project_id=None,
            project_name="T11320 Bug58p Fixture",
            user_id="test-user-t11320",
            profile_id=0,
            credits_deducted=0,
            total_video_seconds=79.0,
            is_test_mode=False,
        )

    # DECISIVE: dispatch must never have happened for this fixture.
    assert spy.calls == [], "call_modal_clips_ai was dispatched for an over-budget export"

    # The REAL channel a client sees is the WS / export_progress payload (this runs in a
    # background task; the raised exception never reaches an HTTP client). Assert the structured
    # fields landed there -- this is what T11330's popup consumes. (Deleting the
    # error_data.update(budget_detail) line in _export_clips MUST fail this test.)
    payload = mc.export_progress[export_id]
    assert payload["status"] == "error"
    assert payload["code"] == "export_too_large"
    assert payload["estimated_gpu_seconds"] > payload["budget_seconds"]
    assert payload["biggest_contributors"]
    assert payload["biggest_contributors"][0]["crop_width"] == 1920

    # The re-raised exception carries the estimate and a readable (non-dict) message, so a
    # background runner writing str(e) into export_jobs.error stores something human-readable.
    assert isinstance(ei.value, ExportBudgetExceeded)
    assert ei.value.estimate.over_budget is True
    assert "GPU time" in str(ei.value) and "{" not in str(ei.value)


@pytest.mark.asyncio
async def test_normal_export_dispatches_unaffected(monkeypatch):
    """A normal small export is NOT rejected: the guard passes and dispatch proceeds.

    The spy raises _DispatchReached the instant it's called, so we prove the guard let the
    export through to call_modal_clips_ai without running the whole post-dispatch pipeline.
    """
    spy = _make_dispatch_spy()
    monkeypatch.setattr(mc, "modal_enabled", lambda: True)
    monkeypatch.setattr(mc, "call_modal_clips_ai", spy)
    monkeypatch.setattr(mc, "upload_bytes_to_r2", lambda user_id, key, content: True)

    clips = [_clip_export(mc, i, duration=5.0, w=410, h=730) for i in range(3)]

    # The spy raises _DispatchReached the instant it's called; _export_clips' generic
    # handler wraps that into an HTTPException. We don't care about the wrapper -- only
    # that dispatch was REACHED (guard let the export through).
    with pytest.raises(Exception) as ei:
        await mc._export_clips(
            export_id="exp-t11320-normal",
            clips=clips,
            aspect_ratio="9:16",
            transition={"type": "cut", "duration": 0.0},
            include_audio=False,
            target_fps=30,
            export_mode="quality",
            project_id=None,
            project_name="T11320 Normal Fixture",
            user_id="test-user-t11320",
            profile_id=0,
            credits_deducted=0,
            total_video_seconds=15.0,
            is_test_mode=False,
        )

    # Guard did NOT reject -> dispatch was reached exactly once.
    assert len(spy.calls) == 1
    # Sanity: the failure is the dispatch sentinel, NOT a budget rejection.
    assert not isinstance(ei.value, ExportBudgetExceeded)
