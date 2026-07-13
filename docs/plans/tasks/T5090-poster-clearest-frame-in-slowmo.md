# T5090: Link-preview poster = clearest frame in the first half of the slow-mo section

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-07-13
**Updated:** 2026-07-13

## Problem

The share-link preview image (og:image poster, T4890) should represent the reel's money shot. User direction (2026-07-13): pick the **clearest frame within the FIRST HALF of the slow-mo section** if the reel has a slow-mo section; if there's no slow-mo, **just use the first frame**.

Rationale: in a sports highlight, the slow-mo marks the key moment (the goal/catch/tackle), and its first half is the build-up-to-impact — the most compelling, most legible frame. Sampling the whole clip (current behavior) can land on a blurry mid-play frame or the wrong moment entirely.

**This refines the clearest-frame heuristic that just shipped** (see T4950-clearest-frame-posters-rollout / [poster.py](../../src/backend/app/services/poster.py)): today `extract_clearest_frame_jpeg` samples 5 fixed fractions across the ENTIRE final video (`CANDIDATE_POSITIONS = 0.15..0.85`) and keeps the largest JPEG. The new policy scopes that search to the slow-mo region (first half) and otherwise falls back to plain first-frame — it does NOT sample the whole clip when there's no slow-mo.

## Solution

New poster-frame policy:
1. Determine the reel's **first slow-mo section** = the first segment whose `segmentSpeeds[i] < 1.0`, in playback order across the (possibly multi-clip) reel.
2. If one exists, compute its **window in the FINAL rendered video's timeline** (slow-mo stretches source time: `final_dur = source_dur / speed`), take the **first half** of that window, and run the existing clearest-frame JPEG-size heuristic over a few samples **within that half**.
3. If there's no slow-mo section anywhere in the reel, use `extract_first_frame_jpeg` (the plain first frame).

### Key enabler — the source->final time mapping already exists
[highlight_transform.py](../../src/backend/app/highlight_transform.py) already does exactly this walk to remap highlight keyframe times onto the stretched output timeline — reuse it, do not reinvent:
- `get_segment_speed(segments_data, i)` (:67) — speed per segment (string keys).
- `canonicalize_segments_data(...)` (:86) — normalizes the dual boundary format (full-list vs splits-only; see the segments_data dual-format landmine).
- The segment walk (`segment_output_duration = segment_source_duration / speed`, :177-181 / :270-272) and `calculate_effective_output_duration` (:135) — the primitives to accumulate each segment's start/end in FINAL-video time (respecting `trimRange`).

So the design is: canonicalize -> walk segments accumulating final-timeline offsets -> find first segment with speed < 1.0 -> its final-time `[start, start + final_dur/2]` is the sampling window.

### Data model (ground truth)
- `SegmentsData` ([schemas.py:105](../../src/backend/app/schemas.py#L105)): `boundaries` (sorted source-time split points, secs; segment i spans `boundaries[i]..boundaries[i+1]`), `segmentSpeeds` (dict `"i" -> multiplier`, missing = 1.0, `<1.0` = slow-mo), `trimRange`. Stored as JSON in `working_clips.segments_data`.
- Poster generation runs in [overlay.py](../../src/backend/app/routers/export/overlay.py) via `generate_and_store_poster(user_id, output_filename)` with `project_id` in scope — so the project's working-clip segment data is reachable and can be threaded into poster generation.

### Design questions to resolve
1. **Multi-clip reels:** a project concatenates multiple working clips, each with its own `segmentSpeeds`. "First slow-mo section" = first across the concatenation. Accumulate per-clip final durations (`calculate_effective_output_duration` per clip) as offsets, then locate the first slow-mo segment's absolute position in the final timeline. Single-clip is the common case; handle multi-clip correctly, not just clip 0.
2. **Branded outro** (~1.75s, appended after render) sits after all content — irrelevant to slow-mo location, but don't let it shift offsets (it's appended, not interleaved).
3. **`generate_and_store_poster` signature** must gain the segment info (single-clip: that clip's segments_data; multi-clip: ordered clips + their segments_data). Thread it from the overlay finalize path where `project_id` and the working clips are known.
4. **Backfill path** ([poster.py](../../src/backend/app/services/poster.py) `backfill_posters`, `force=True`): the admin regen must reconstruct segments_data per final video from the DB (project -> working_clips -> segments_data). Heavier than the live path; ensure the same policy applies so backfilled and freshly-published posters match. If segments_data is unavailable for an old reel, fall back to first frame (not whole-clip sampling).
5. **Fallbacks (no silent wrong data):** no segments_data / parse failure / empty window -> first frame; log at info. Never fabricate a slow-mo region.

### Sequencing with the in-flight rollout
The concurrent **T4950-clearest-frame-posters-rollout** is doing a prod force-regen of posters using the current whole-clip heuristic. This task changes the selection algorithm, so either land T5090 first, or plan a second force-regen after T5090 so prod posters reflect the slow-mo-first policy. Note the dependency; don't let the two regens fight.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/poster.py` — `extract_clearest_frame_jpeg` (rescope to slow-mo window), `extract_first_frame_jpeg` (no-slow-mo fallback), `generate_and_store_poster` (add segments param), `backfill_posters` (reconstruct segments)
- `src/backend/app/highlight_transform.py` — reuse `get_segment_speed`, `canonicalize_segments_data`, effective-duration/segment-walk helpers for the source->final mapping
- `src/backend/app/routers/export/overlay.py` — poster call site; thread project working-clip segments_data in
- `src/backend/app/schemas.py` — `SegmentsData` (boundaries/segmentSpeeds/trimRange)
- `src/backend/app/routers/export/multi_clip.py` — multi-clip concat ordering (for per-clip offsets)
- Tests: a `poster.py` unit test with synthetic segments (slow-mo present -> window math; multi-clip offset; no slow-mo -> first frame)

### Related Tasks
- Refines: T4950 (clearest-frame posters rollout — whole-clip heuristic + prod force-regen); coordinate the regen sequencing
- Builds on: T4890 (poster/og:image mechanism), v024 `poster_filename` migration
- Knowledge: [export-pipeline.md](../../.claude/knowledge/export-pipeline.md), [keyframes-framing.md](../../.claude/knowledge/keyframes-framing.md); segments_data dual-format landmine (memory)

### Technical Notes
- M-tier: backend-only, ~2-4 files, no schema change (reuses `poster_filename`). The mapping helpers already exist, so the real work is the segment walk + threading segments into the poster path + multi-clip offsets + backfill reconstruction.
- "First half" is measured in the FINAL (stretched) timeline since sampling runs on the final video; the clearest-frame JPEG-size heuristic is unchanged, only its sampling window changes.
- Keep it best-effort: poster failure never fails export (existing invariant).

## Implementation

### Steps
1. [ ] Add a helper that, given ordered working-clip segments_data, returns the first slow-mo section's `[start, end]` in FINAL-video time (reusing highlight_transform walk), or None
2. [ ] Rescope `extract_clearest_frame_jpeg` to sample within the first half of that window; when None, call `extract_first_frame_jpeg`
3. [ ] Thread project segments_data into `generate_and_store_poster` from the overlay finalize path (single + multi-clip)
4. [ ] Update `backfill_posters` to reconstruct segments_data per final video (fallback to first frame if unavailable)
5. [ ] Tests: slow-mo window math, multi-clip offset, trimRange respected, no-slow-mo -> first frame, missing data -> first frame
6. [ ] Coordinate prod poster force-regen with T4950 (regen after this lands)

### Progress Log

**2026-07-13**: Task created from user direction (clearest frame in the first half of the slow-mo section; else first frame). Investigation: clearest-frame poster already shipped (whole-clip 5-sample heuristic, poster.py); the source->final time mapping needed to locate slow-mo already exists in highlight_transform.py; poster is generated in overlay.py with project_id in scope. Refines T4950's whole-clip heuristic.

## Acceptance Criteria

- [ ] Reels WITH a slow-mo section get a poster that is the clearest frame within the first half of the first slow-mo section (final-timeline), including correct multi-clip offset and trimRange handling
- [ ] Reels WITHOUT any slow-mo get the plain first frame (not whole-clip sampling)
- [ ] Live publish and admin backfill/force-regen apply the SAME policy; missing segments_data falls back to first frame (logged, no fabrication)
- [ ] Poster failure still never fails the export
- [ ] Prod regen sequenced with T4950 so posters reflect the new policy
- [ ] Tests pass
