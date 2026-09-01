# Tbug49p — Modal cloud export ignores source fps, producing slow/fast-motion output

**Bug (prod 49p, reporter bknoto@gmail.com):** exported videos play in slow motion despite
never touching speed controls. Root-caused via expert (Opus) investigation — full analysis
in the escalation transcript; summarized below.

**Status:** WIP — implementing fix directly (M-tier, no design gate required).

---

## Stage 0 — Classification

| Field | Value |
|-------|-------|
| **Tier** | **M** — 2 backend files, ~35 LOC, no schema change, no new abstraction (mirrors the already-correct local encoder). |
| **Stack Layers** | Backend only (Modal GPU render path). |
| **Files Affected** | `src/backend/app/modal_functions/video_processing.py`, `src/backend/app/routers/export/multi_clip.py`. |
| **LOC Estimate** | ~35 |
| **Test Scope** | Backend unit (ffmpeg command construction, keyframe-time conversion) + documented staging verification (real non-30fps upload; Modal path is NOT reproducible in a container). |
| **Knowledge Docs** | `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/export-pipeline.md` |

| Agent | Include? | Justification |
|-------|----------|----------------|
| Code Expert | No | Expert agent already root-caused this end-to-end with exact arithmetic proof against prod data. |
| Architect | No | Fix mirrors an existing correct implementation (`video_encoder.py`); no new pattern. |
| Tester | No | M-tier; ~8 focused tests written directly alongside the fix. |
| Reviewer | Yes | Touches the deployed Modal render path + credit-charged export code; high blast radius. |
| Migration | No | No schema change. |

---

## Root Cause

`process_clips_ai` (`video_processing.py`) is the only render path production traffic uses.
It reads every source frame, indexed by the SOURCE fps (`original_fps`), but
`_build_simple_ffmpeg_cmd` declares the PNG sequence to ffmpeg at the hard-coded TARGET fps
(30, `-framerate 30`) with no `-r` output flag. Output duration becomes
`source_duration x (source_fps / 30)`:

- 50fps source -> 1.667x slow motion (bknoto's game 16, exact 6-decimal match against his
  real `final_videos.duration` row: 863 source frames / 30 = 28.766667s).
- 60fps source -> 2.0x slow.
- 25fps source -> 1.2x fast.
- 29.97fps source -> 0.1% off, imperceptible (why this survived so long).

**The correct implementation already exists** in the local (non-Modal) encoder
(`app/ai_upscaler/video_encoder.py:273,780` — feeds input at `original_fps`, forces output
`-r <target_fps>`) and in the parallel-chunk Modal function
(`process_framing_ai_chunk`, `video_processing.py:2185`). Only the two SEQUENTIAL Modal
functions (`process_clips_ai`, and dead-code `process_framing_ai`/`_parallel`) got it wrong.

**Blast radius (full prod scan, 117 game videos across 70 profile DBs):** 4 affected videos —
bknoto's game 16 (50fps), plus 3 OTHER accounts' very first game upload (game 1): one 60fps,
two 25fps. The other three are all first-exports for new users — a plausible silent
contributor to onboarding drop-off.

**Secondary defect, same root cause, fixed in this task too:** `multi_clip.py:2306` hard-codes
`framerate = 30` when converting stored frame-based crop keyframes to times on the DB-resolve
multi-clip path (the SELECT at `:2257-2273` doesn't even fetch `wc.fps`). For a non-30fps
clip this mis-times every crop keyframe (bknoto's frame-854 keyframe would resolve to 28.5s
instead of 17.1s, past the clip end — crop freezes). `ClipExportData.source_fps` already
carries the correct value on the single-clip path (`framing.py:673`) but is read by nobody.

---

## Fix

**A — `video_processing.py` (primary, encode correctness):**
1. `_build_simple_ffmpeg_cmd`: add an `input_fps` param. Both branches: `-framerate
   <input_fps>` for the PNG input (was `<fps>`), add `-r <fps>` as an OUTPUT option. Audio
   branch's `-t <frame_count/fps>` becomes `<frame_count/input_fps>` (real-time length of the
   frame sequence).
2. `process_clips_ai`: pass `original_fps` as `input_fps` at both call sites.
3. Speed-change filtergraph branch: `output_duration = output_frame_idx / original_fps`
   (was `/ fps` — also mis-clamped segment ends), `-framerate <original_fps>` on both those
   output commands, plus add `-r <fps>`.

`-r <target_fps>` is mandatory, not optional — downstream (detection timestamps, highlight
region frames, `SNAPSHOT_FRAMERATE`) assumes the working video is 30fps CFR. This restores
local<->Modal parity rather than creating new drift.

**B — `multi_clip.py` (crop timing):** add `wc.fps`/`gv.fps` to the DB-resolve SELECT
(`:2257-2273`), replace hard-coded `framerate = 30` (`:2306`) with `wc.fps or gv.fps` (log
loudly if both NULL, mirroring `framing.py:584`, before falling back to 30). The
`game_videos` join predicate needed `COALESCE(rc.video_sequence, 1)` (matching
`clips.py:1616,2142,995`) -- without it, legacy single-video-game clips (NULL
`video_sequence`) silently lose `gv.fps`, no-oping the fix for exactly the legacy cohort
bug 49p's reporter is in. Caught by review.

**Dropped from this task (review, BLOCKING):** threading `ClipExportData.source_fps` into
`_build_framing_snapshot`'s `"fps"` was attempted but reverted -- `highlight_transform.py`'s
`transform_all_regions_to_working` uses that value for BOTH a source-fps conversion (crop
keyframes, correct) AND a working-video-frame conversion (`working_frame = round(working_time
* framerate)`, which must always be 30 since the working video is always rendered at
`SNAPSHOT_FRAMERATE` -- exactly what this task's `-r <fps>` now guarantees). Threading
`source_fps` through would persist carried highlight keyframes in the wrong unit on a future
re-export of a non-30fps project. Left at the fixed `SNAPSHOT_FRAMERATE`; a correct fix needs
the transform split into separate source/working rate params -- filed as a follow-up, not
bundled into this correctness fix (smaller blast radius: the 4 known-broken videos get fixed
without risking every 29.97fps project's carry fast-path).

**Extracted for testability (review):** the speed-change filtergraph branch in
`process_clips_ai` (5 of the fps hand-edits landed here) had zero test coverage and was the
review's top-priority gap. Pulled into `_build_speed_change_ffmpeg_cmd`, a sibling of
`_build_simple_ffmpeg_cmd`, mechanical move only (no behavior change) -- now covered by
`tests/test_tbug49p_export_fps.py`.

**Explicitly out of scope:** the dead `process_framing_ai`/`_parallel` family
(`video_processing.py:1652` etc.) has the identical bug but zero production callers — left
unfixed, flagged here so a future reader doesn't assume it's live.

**Deliberately not attempted here:** sampling source frames at target cadence in the read
loop (correct duration + ~40% less GPU on a 50fps source) — strictly better but rewrites the
hot loop; filed as a follow-up cost optimization, not bundled into this correctness fix.

---

## Rollout (NOT part of "commit" — needs explicit approval, see workflow docs)

1. Merge to master (staging auto-deploys, but **staging deploy does NOT touch Modal** —
   `modal deploy` is a separate manual step per `.claude/knowledge/modal-gpu.md`).
2. **Manual `modal deploy`** required before this fix is live — the code fix is inert until
   redeployed to the Modal app.
3. Staging verification: upload a real non-30fps clip, export, `ffprobe` the working video,
   assert `duration == source_duration +/- 1 frame` and `r_frame_rate == 30/1`. NOT
   verifiable in a container (local render already takes the correct path).
4. **Ops (user's call, decided 2026-09-01):** once redeployed, re-run bknoto's framing
   export server-side for him at no charge (no credits, no action needed on his end).
   Proactively email the 3 other affected first-export accounts once fixed, offering the
   same remediation.
