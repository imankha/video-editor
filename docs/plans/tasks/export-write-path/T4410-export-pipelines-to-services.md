# T4410: Export Pipelines → Services + Sweep Unification

**Status:** TODO
**Impact:** 9
**Complexity:** 8
**Created:** 2026-07-03
**Epic:** [export-write-path](EPIC.md) · Audit items E8 + E9-partial · Depends on T4380, T4390 (and benefits from T4400)

## Problem

`routers/export/` is 5,878 lines. `multi_clip.py` (2,500 L) has 3 routes; the rest is YOLO model loading (:94), local detection (:118-395), FFmpeg concat/chapters (:1035-1190), and a 640-line `_export_clips` (:1191-1831). Six trigger pipelines exist with duplicated glue — two `send_progress` (`export_worker.py:56` vs `export_helpers.py:156`, whose docstring claims "single entry point"), two `create_progress_callback` (:79 vs :209), two post-export syncs (`_sync_after_export` :114 vs `sync_export_db_to_r2` :333 — only the latter has T4110 durability). The **sweep auto-export is a fully parallel universe**: no export_jobs record, own ffmpeg commands, own R2 upload (auto_export.py:237, :393), status in `games.auto_export_status` compared as raw literals (sweep_scheduler.py:189-191).

## Solution (slices — each its own reviewable unit, mechanical moves separated from behavior changes)

1. **Merge the helper pairs** (progress, sync): keep the T4110-durable sync; one send_progress. Behavior-preserving; snapshots prove it.
2. **Move detection to `services/detection.py`** (YOLO load + local detection); move multi-clip assembly (`_export_clips`, concat/chapters) to `services/multi_clip_export.py`. Pure code motion commits; routers keep routing + validation.
3. **Overlay's 300-line action dispatcher** (`overlay.py:348-645`) and framing's (`clips.py:326-542`): extract a shared command-dispatcher SHAPE (registry of action handlers) — but they persist to different columns; unify the dispatch pattern, NOT the handlers. (If T4330 landed, its 409 logic lives here once, too.)
4. **Sweep onto the main rails:** `auto_export_game` creates a real export_jobs record (T4380 repository), publishes via T4390's `publish_final_video`, syncs via the ONE durable sync. `games.auto_export_status` stays (it's game-level state) but its values become an enum. The sweep's deliberate semantics (skip-if-published-reel per T4160, auto-publish) are parameters, preserved by test.

## Context

- The biggest single de-risk: T4390 already unified the WRITES. This task moves the surrounding orchestration; the finalize/publish behavior can no longer drift while you move it.
- `modal_functions/` is NOT in scope (that's T4420/T4430's territory).
- Suggested execution: one /dotask container per slice; slices 1-2 are safe openers, 4 is the semantic one — re-read T4160's task file + tests before touching auto_export.

## Steps

1. [ ] Slice 1 (helper pairs) → snapshots green.
2. [ ] Slice 2 (code motion) → import check + snapshots green; commits contain zero behavior edits.
3. [ ] Slice 3 (dispatcher shape) → both action endpoints' tests green.
4. [ ] Slice 4 (sweep) → sweep-specific T4370 snapshot green + T4160 regression tests green.

## Acceptance Criteria

- [ ] routers/export/*.py contain routing/validation only (spot-checkable: no cv2/ffmpeg/YOLO imports in routers)
- [ ] One send_progress, one progress callback factory, one post-export sync (the durable one)
- [ ] Sweep exports appear in export_jobs and go through the shared publish writer
- [ ] Every slice landed as an independently-reviewed unit with snapshots green
