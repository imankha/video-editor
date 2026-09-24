# T11250: Remove multi-clip backend - clip-management endpoints + export N>1 branches

**Status:** TODO
**Impact:** 6
**Complexity:** 6
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Single-Clip Editor](EPIC.md)

## Problem

Once the frontend stops producing multi-clip projects (T11240), the backend still exposes
endpoints that add, upload into, reorder and remove clips in a project, plus ~2,000 lines of
N>1 export, concat, chapter and transition code.

## Solution

**Endpoints (delete):** `POST /projects/{pid}/clips` add-from-library (`clips.py:1828`),
`POST .../clips/upload-with-metadata` (`:2200`), `PUT .../clips/reorder` (`:2316`),
`DELETE .../clips/{cid}` (`:2900`; deleting the project covers it).

**Invariant:** one working clip per project enforced at the remaining insert sites
(`create_reel_for_clip` `clips.py:1105-1112`, `auto_export.py:495`, `project_archive.py:251`
restore) + a test. No DB constraint (version rows share a project). No schema migration.
Keep `_insert_working_clip_with_dims`'s signature stable (frozen migration v021 uses it).

**Export (delete N>1 branches, keep the module):**
- `export_multi_clip` + `_run_multi_clip_background` (`multi_clip.py:2032-2528`)
- `concatenate_clips_with_transition` + chapter helpers (`:1135-1290`)
- `services/transitions/` package + re-export in `services/__init__.py:26,61`
- `ffmpeg_service.py:326-400` chapter helpers if no other callers
- Simplify `build_clip_boundaries_from_*` (`:648-741`, drop dissolve), `concat_offsets` (:148),
  `calculate_multi_clip_resolution` (:1003), local N-loop (:1700-1815),
  `export_finalize.py:355-406` (transition always cut)

**Keep:** `_export_clips`, `finalize_export`, `upsert_working_video`, goldens, intra-clip speed
segment `concat=` filtergraphs (`:1795`, `:3191`), `stitch_members` / `compose_serve_time_modal`
(collections, T11300 seed). **Modal untouched** (R10).

## Context

### Tests
Delete: `test_transitions.py`, `test_t6450_multiclip_row_get_crash.py`,
`test_multi_clip_local_db_delta` (`test_export_golden_local_render.py:105`). Rewrite:
`test_export_golden_multiclip_modal.py` (the T11210 single-clip golden replaces it),
`test_t4200_framing_multiclip_durability.py` (re-point to one clip), multi-clip branches of
`test_t4350_*`.

### Related Tasks
- Depends on: T11210 (golden), T11240 (no frontend callers)
- Blocks: T11260

## Acceptance Criteria

- [ ] Single-clip goldens (local + Modal) byte-identical before/after
- [ ] Every insert site refuses a second clip (test per site)
- [ ] Deleted endpoints 404/405; zero references
