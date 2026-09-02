# T8280: Offer a 30fps export option for high-fps sources (cheaper, same perceived quality)

**Status:** WIP
**Impact:** 6
**Complexity:** 7
**Created:** 2026-09-01

## Problem

**This is NOT a re-opening of Tbug49p.** That bug (source fps ignored, causing slow/fast-motion
output) is fixed and deployed — every export now correctly plays back at the right SPEED
regardless of source fps, because the render always forces the output to the target fps via
`-r <target_fps>` (`video_processing.py`, `_build_simple_ffmpeg_cmd` / `_build_speed_change_ffmpeg_cmd`).
This task is a follow-on **cost and choice** feature, not a correctness fix.

**The cost problem Tbug49p's investigation surfaced but didn't fix:** `process_clips_ai` reads
and GPU-upscales EVERY source frame before the fps-conversion happens at final encode time. For
a 50fps source, that means upscaling 863 frames when only ~518 survive into the 30fps output —
**~40% of the GPU compute is thrown away**, and the user pays for all of it, because credits are
charged as `math.ceil(video_seconds)` (`framing.py:473`, `multi_clip.py:2155`) — **flat per second
of source duration, with no fps term at all.** A 50fps clip and a 30fps clip of identical duration
cost the user the same, despite costing us ~67% more GPU time to render the 50fps one.

**The user-facing gap:** nobody recording above 30fps (drone footage, some phone slow-mo modes,
certain sports cameras) has any visibility into this, or any way to opt for a cheaper render.
For the vast majority of casual/social viewing, a 30fps output is indistinguishable in quality
from the native fps — the extra frames buy smoother motion that most viewers on a phone screen
won't notice, but the export currently pays full price for them regardless.

**Threshold nuance (important, from Tbug49p's fleet scan):** do NOT trigger this for 29.97fps
sources. The full-prod scan found 50 game videos at 29.97fps (standard NTSC) versus only 4
genuinely high/uneven-fps videos (one 50fps, one 60fps, two 25fps). 29.97 rounds to "30" for every
practical purpose (0.1% duration drift, imperceptible) — prompting the 29.97fps majority with an
irrelevant cost-choice would be noise, not a feature. Gate on something like `fps >= 31` (or an
explicit tolerance band around 30), not `fps != 30`.

## Solution (proposed — needs Architect sign-off, see Open Questions)

1. **Detect at export time** whether the clip's source fps exceeds the threshold (fps detection
   already exists: `original_fps` via `cv2.VideoCapture` in `process_clips_ai`, and the ffprobe
   path in `framing.py:574-584` for the single-clip UI-facing cost preview).
2. **Compute and show BOTH credit costs** before the user exports — a "30fps (recommended)" price
   and a "native {fps}fps" price — with a short explainer ("Your video was recorded at {fps}fps.
   Exporting at 30fps looks just as smooth for most viewers and costs fewer credits.").
3. **Let the user pick** via a control in the Focus/export settings panel (where the existing
   "~18 credits · balance 44" line already lives, `FocusScreen`/export settings area) — default
   selection: 30fps (cheaper), native available for users who want maximum smoothness (e.g.
   fast action shots) or plan to re-edit the footage elsewhere later.
4. **Backend: implement the actual frame-skip-at-read optimization** for the 30fps choice —
   sample source frames at ~30fps cadence during the READ loop in `process_clips_ai`
   (`video_processing.py`, the `for frame_num in range(start_frame, end_frame)` loop, currently
   ~line 2781+), so the GPU only upscales the frames that will survive to the final output,
   instead of upscaling everything and discarding the excess at encode time. This is exactly the
   optimization Tbug49p's task doc filed as "deliberately not attempted" (see that doc's Fix A
   section) — do the correctness fix's job now, for real, gated behind the user's choice.
5. **Backend: give the credit formula an fps term.** Exact formula is an open pricing question
   (see below), but the shape should be: 30fps-choice cost stays at (or near) today's
   `ceil(video_seconds)`, native-fps cost scales up with the actual frame-processing multiplier
   (`fps / 30`, roughly — a 50fps native export costs ~1.67x today's price, matching the real GPU
   cost difference).
6. **Overlay/multi-clip exports inherit the framing choice**, they don't get their own prompt —
   per Tbug49p's finding, overlay export reads the ALREADY-RENDERED working video's own fps and
   re-emits at that rate (`video_processing.py:411,425`); it doesn't independently resample. So
   the choice is made once, at the Focus/framing export step, and everything downstream follows it.

## Context

### Relevant Files
- `src/backend/app/modal_functions/video_processing.py` — `process_clips_ai`'s frame-read loop
  (~line 2757-2844) is where the frame-skip-at-read optimization goes; `_build_simple_ffmpeg_cmd`
  / `_build_speed_change_ffmpeg_cmd` (Tbug49p's fix) is where the input/output fps split already
  lives and would need a third mode (native passthrough vs down-sampled read).
- `src/backend/app/routers/export/framing.py:472-473` — single-clip credit formula
  (`math.ceil(video_seconds)`, no fps term).
- `src/backend/app/routers/export/multi_clip.py:2149-2155` — multi-clip credit formula, same
  shape, same gap.
- `src/backend/app/routers/export/framing.py:574-584` — existing ffprobe-based real-fps
  detection on the single-clip path; reuse for the cost-preview computation.
- Frontend: wherever "~18 credits · balance {N}" renders in the Focus export panel
  (`FocusScreen`/`ExportButtonContainer` area) — natural home for the two-price comparison UI.
- `docs/plans/tasks/Tbug49p-modal-export-fps-mismatch.md` — root cause + the "deliberately not
  attempted" note this task follows up on; read it first for full context on why the frame-drop
  approach is safe (ffmpeg's `-r` already forces CFR either way; this task changes WHERE the drop
  happens — at read/upscale time instead of at final encode — not WHETHER it happens).

### Technical Notes
- **This does not touch the crop-keyframe timing fix** (Tbug49p Fix B, `multi_clip.py`'s
  `wc.fps`/`gv.fps` resolution) — crop keyframes stay authored in source-fps space regardless of
  which export-fps choice the user makes; only the OUTPUT frame rate changes.
- **Real GPU cost savings, not just a UI framing exercise** — the frame-skip-at-read change is a
  genuine ~40% compute reduction for a 50fps source, so the "cheaper" claim in the UI copy must be
  backed by an actual pipeline change, not just a discounted price on unchanged work.
- Watch the interaction with the speed-change filtergraph path (`_build_speed_change_ffmpeg_cmd`)
  — segment speed changes (0.5x etc.) do their own PTS math against `original_fps`; the frame-skip
  optimization must not break that branch's timing (test both paths, mirroring Tbug49p's
  real-ffmpeg reproduction-test pattern — build a real non-30fps test video, run both the native
  and 30fps-choice paths through real ffmpeg, verify durations AND frame counts).
- No schema change is obviously required (the choice is a per-export request param, not persisted
  account state) unless the design wants to remember a user's last choice as a default — flag as
  an open question, don't assume.

## Open Questions (Architect gate — this is why the task is L-tier)

1. **Exact credit formula.** Proposed: `credits_30fps = ceil(video_seconds)` (today's price,
   unchanged), `credits_native = ceil(video_seconds * max(1, fps/30))`. Confirm this actually
   reflects real GPU-seconds cost (check against Modal's actual billed GPU-seconds for a sample
   50fps vs 30fps render of the same duration, don't guess) before shipping a number to users.
2. **Does "native" mean the delivered file is actually native fps** (bigger file, genuinely
   smoother motion — the real product value), or does it just mean "upscale every frame but still
   force 30fps out" (in which case there's no visible difference between the two choices and the
   feature is pointless)? Recommendation: native should deliver native fps. Confirm this doesn't
   break anything downstream that assumes working videos are always 30fps CFR (overlay's highlight
   region timing, `SNAPSHOT_FRAMERATE` assumptions flagged in Tbug49p's follow-up doc
   `Tbug49p-followup-highlight-transform-fps-units.md` — a native-fps working video would need the
   SAME source/working-fps unit split that follow-up already identified as unfinished work, so
   this task may be blocked on that follow-up landing first).
3. **Exact threshold** for "high fps" (proposed `fps >= 31`, i.e. excludes 29.97) — confirm with
   real fleet data before picking a number.
4. **UI placement and copy** — needs the ui-designer's pass, not just a functional toggle; this is
   a real product/pricing surface, not a settings checkbox.
5. **Does the user's choice persist** as an account/project default, or is it asked every export?

## Acceptance Criteria

- [ ] A clip whose source fps is above the (confirmed) threshold shows both a "30fps" and
      "native fps" credit price before export, with a plain-language explanation of the tradeoff.
- [ ] Choosing 30fps actually upscales fewer frames (verified via GPU-seconds or wall-clock
      comparison, not assumed from the credit price alone) and produces correct-duration,
      correct-speed output (same real-ffmpeg reproduction-test pattern as Tbug49p).
- [ ] Choosing native fps delivers a genuinely native-fps output file (if Open Question 2 resolves
      that way) with correct duration/speed, and doesn't break any downstream assumption that
      working videos are 30fps (highlight regions, thumbnails, etc.) — or is explicitly scoped to
      NOT do this if Open Question 2 resolves the other way.
- [ ] A 29.97fps source does NOT get prompted (threshold correctly excludes it).
- [ ] Credit formula change is verified against real Modal GPU-seconds billing for at least one
      real high-fps test render, not assumed from a formula alone.
- [ ] Overlay/multi-clip exports correctly inherit whichever fps the framing step chose, with no
      separate prompt.
