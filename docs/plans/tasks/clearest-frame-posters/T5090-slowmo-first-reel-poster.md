# T5090: Slow-mo-first reel poster (clearest frame in first half of slow-mo)

**Status:** TODO
**Impact:** 5 | **Complexity:** 4
**Epic:** [Clearest-Frame Posters](EPIC.md) — child 1 of 3
**Created:** 2026-07-13

> Read [EPIC.md](EPIC.md) for shared context: what already shipped (commit 175f6253), the
> per-artifact poster policy, the no-silent-fallback rule, and the single-regen sequencing.

## Problem

The reel's og:image poster (T4890) should be its money shot. Today `extract_clearest_frame_jpeg`
samples 5 fixed fractions across the ENTIRE final video and keeps the largest JPEG — which can
land on a blurry mid-play frame or the wrong moment. User direction (2026-07-13): pick the
**clearest frame within the FIRST HALF of the slow-mo section** if the reel has one; if there's
**no slow-mo, use the plain first frame** (not whole-clip sampling).

Rationale: the slow-mo marks the key moment (goal/catch/tackle); its first half is the
build-up-to-impact — the most compelling, most legible frame.

## Solution

New reel poster policy:
1. Find the reel's **first slow-mo section** = the first segment with `segmentSpeeds[i] < 1.0`
   in playback order across the (possibly multi-clip) reel.
2. If one exists, compute its window in the FINAL rendered timeline (slow-mo stretches:
   `final_dur = source_dur / speed`), take the **first half** of that window, and run the
   existing clearest-frame JPEG-size heuristic over a few samples **within that half**.
3. If there's no slow-mo section anywhere, use `extract_first_frame_jpeg`.

### Key enabler — the source->final mapping already exists (reuse, don't reinvent)

[highlight_transform.py](../../../src/backend/app/highlight_transform.py) already remaps times
onto the stretched output timeline:
- `get_segment_speed(segments_data, i)` (:67) — per-segment speed (string keys).
- `canonicalize_segments_data(...)` (:86) — normalizes the dual boundary format (full-list vs
  splits-only; see the segments_data dual-format landmine in memory).
- Segment walk (`segment_output_duration = segment_source_duration / speed`, :177-181 / :270-272)
  and `calculate_effective_output_duration` (:135) — accumulate each segment's start/end in
  FINAL-video time, respecting `trimRange`.

Design: canonicalize -> walk segments accumulating final-timeline offsets -> first segment with
speed < 1.0 -> its final-time `[start, start + final_dur/2]` is the sampling window.

### Data model (ground truth)
- `SegmentsData` ([schemas.py:105](../../../src/backend/app/schemas.py#L105)): `boundaries`
  (sorted source-time split points; segment i spans `boundaries[i]..boundaries[i+1]`),
  `segmentSpeeds` (dict `"i" -> multiplier`, missing = 1.0, `<1.0` = slow-mo), `trimRange`.
  Stored as JSON in `working_clips.segments_data`.
- Poster generation runs in [overlay.py](../../../src/backend/app/routers/export/overlay.py) via
  `generate_and_store_poster(user_id, output_filename)` with `project_id` in scope — the
  project's working-clip segment data is reachable and can be threaded in.

### Design questions to resolve
1. **Multi-clip reels:** a project concatenates multiple working clips, each with its own
   `segmentSpeeds`. "First slow-mo section" = first across the concatenation. Accumulate per-clip
   final durations (`calculate_effective_output_duration` per clip) as offsets, then locate the
   first slow-mo segment's absolute position in the final timeline. Handle multi-clip correctly,
   not just clip 0 (single-clip is the common case).
2. **Branded outro** (~1.75s, appended after render) sits after all content — don't let it shift
   offsets (it's appended, not interleaved).
3. **`generate_and_store_poster` signature** gains the segment info (single-clip: that clip's
   segments_data; multi-clip: ordered clips + their segments_data). Thread from the overlay
   finalize path where `project_id` + working clips are known.
4. **Backfill path** (`backfill_posters`, `force=True`): reconstruct segments_data per final
   video from the DB (project -> working_clips -> segments_data) so backfilled and freshly
   published posters match. If unavailable for an old reel -> first frame (per EPIC no-fallback
   rule), not whole-clip sampling.
5. **Fallbacks:** no segments_data / parse failure / empty window -> first frame; log at info.

## Relevant files
- `src/backend/app/services/poster.py` — `extract_clearest_frame_jpeg` (rescope to slow-mo
  window), `extract_first_frame_jpeg` (no-slow-mo fallback), `generate_and_store_poster` (add
  segments param), `backfill_posters` (reconstruct segments)
- `src/backend/app/highlight_transform.py` — reuse the source->final mapping helpers
- `src/backend/app/routers/export/overlay.py` — poster call site; thread segments_data in
- `src/backend/app/schemas.py` — `SegmentsData`
- `src/backend/app/routers/export/multi_clip.py` — multi-clip concat ordering (per-clip offsets)

## Steps
1. [ ] Helper: given ordered working-clip segments_data, return the first slow-mo section's
   `[start, end]` in FINAL-video time (reusing highlight_transform walk), or None
2. [ ] Rescope `extract_clearest_frame_jpeg` to sample within the first half of that window;
   None -> `extract_first_frame_jpeg`
3. [ ] Thread project segments_data into `generate_and_store_poster` (single + multi-clip)
4. [ ] Update `backfill_posters` to reconstruct segments_data per final video (fallback -> first frame)
5. [ ] Tests: slow-mo window math, multi-clip offset, trimRange respected, no-slow-mo -> first
   frame, missing data -> first frame

## Classification hint
M-tier, backend-only, ~2-4 files, no schema change (reuses `poster_filename`). The mapping
helpers already exist; the work is the segment walk + threading + multi-clip offsets + backfill
reconstruction. Prod regen is NOT part of this task — it happens once in T4950 after this lands.

## Acceptance criteria
- [ ] Reels WITH slow-mo -> clearest frame in the first half of the first slow-mo section
  (final timeline), correct multi-clip offset + trimRange
- [ ] Reels WITHOUT slow-mo -> plain first frame (not whole-clip sampling)
- [ ] Live publish and admin backfill apply the SAME policy; missing segments_data -> first frame
  (logged, no fabrication)
- [ ] Poster failure still never fails export; tests pass
