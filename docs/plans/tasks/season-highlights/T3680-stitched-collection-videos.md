# T3680: Stitched Collection Videos

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-06-12

## Problem

Live links cover viewing, but parents need a single MP4 to post to Instagram or drop in the team chat. No job type concatenates existing final_videos, and naive concat breaks across mixed resolutions/fps even within one aspect ratio.

## Solution

New `'stitch'` export job type: concat a collection's current members into one MP4 -- stream-copy when parameters match, normalize+encode otherwise. Output is a pinned artifact card with staleness detection. Enables the hidden "Video" verb on every CollectionHeader. See [EPIC.md](EPIC.md) decisions #1, #2, #12.

### Backend job

- `POST /api/exports/stitch` body `{collection_definition}`: resolve current membership server-side (same evaluation as T3620's resolver -- shared function, NOT duplicated), create export_job (`job_type='stitch'`, definition + resolved member ids msgpack'd into `input_data`), background-process via `process_export_job()` routing ([export_worker.py:146-223](../../../../src/backend/app/services/export_worker.py)).
- Processing (CPU-only, local; no Modal function): download members from R2 -> probe each with `get_video_info()` ([ffmpeg_service.py:280](../../../../src/backend/app/services/ffmpeg_service.py)) -> all match codec/resolution/fps => concat-demuxer stream copy; else scale/pad to canonical resolution for the ratio (1080x1920 / 1920x1080), unify fps, encode, concat (reuse `concatenate_clips()` family, line 389-625).
- **Credits: free.** Skip the reservation flow entirely (do not reserve 0) -- framing's credit block at exports.py:536-560 is not invoked for stitch.
- Progress over the existing WS (`make_progress_data`, type `'stitch'`); frontend exportStore consumes as-is.
- Finalize: upload to `final_videos/` R2 prefix; INSERT final_videos row with full mapping:

| Column | Value |
|---|---|
| project_id | NULL |
| filename | `stitch_{slug}_{ratio}_v{n}.mp4` |
| version | MAX+1 over same collection ref |
| source_type | `'stitched_collection'` (new value; display label in sourceTypes map) |
| name | frozen collection title incl. ratio word, e.g. "Top Goals (Portrait) - Spring 2026" |
| duration / aspect_ratio | probed / collection ratio (T3600 columns) |
| tags | NULL |
| game_id | game_id for game-scope collections, else NULL |
| collection_ref | NEW BLOB column (msgpack `{definition, member_final_video_ids}`) -- needs profile_db migration v009 + ensure_database update |

### Frontend

- "Video" verb (un-hide on CollectionHeader): kicks the job; progress via exportStore; on completion the artifact renders as a **pinned card** atop its collection (distinct filmstrip styling), playable/downloadable/shareable like any reel (it IS a final_video).
- **Staleness**: current membership ids vs `collection_ref.member_final_video_ids`; differ -> badge "N new reels since this video -- Regenerate". Slider changes (T3640) naturally change membership -> stale.
- Stitched artifacts are excluded from collection membership evaluation everywhere (they'd recursively include themselves): exclude `source_type='stitched_collection'` in T3620's shared evaluation function -- add the exclusion THERE in this task with a regression test.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/exports.py` - stitch endpoint
- `src/backend/app/services/export_worker.py` - job routing + `process_stitch_export()`
- `src/backend/app/services/ffmpeg_service.py` - probe/concat reuse (extend only if normalization helper missing)
- `src/backend/app/routers/shares.py` (or shared collections service) - membership evaluation reuse + stitched-artifact exclusion
- `src/backend/app/migrations/profile_db/v009_collection_ref.py` - NEW
- `src/backend/app/database.py` - ensure_database update
- `src/frontend/src/components/collections/CollectionHeader.jsx` - Video verb
- `src/frontend/src/components/collections/StitchedArtifactCard.jsx` - NEW pinned card + staleness badge
- `src/frontend/src/stores/exportStore.js` - accept 'stitch' type (likely zero-change; verify)
- `src/frontend/src/config/sourceTypes.js` - label for stitched_collection

### Related Tasks
- Depends on: T3600 (columns), T3610 (header), T3620 (membership evaluation function), T3630/T3640 (ordering/budget determine member list)
- Last task in epic; "Video" verb hidden until this ships (EPIC decision #12)

### Technical Notes
- Pipeline anatomy: tech-notes section 4. Local processors must not block the event loop -- follow T1110's `asyncio.to_thread` convention and T2640's subprocess guidance for dev.
- Stream-copy eligibility is conservative: any mismatch (codec/profile/resolution/fps/audio params) -> normalize path. Correctness over speed.
- Free job + heavy CPU: cap concurrent stitch jobs per user at 1 (reject with 409 if one is running).
- Include **Migration agent** (v009).

## Implementation

### Steps
1. [ ] v009 migration (collection_ref) + schema update
2. [ ] Stitch endpoint + membership resolution reuse + 1-per-user guard
3. [ ] `process_stitch_export`: probe -> stream-copy/normalize -> concat -> upload -> finalize row
4. [ ] WS progress wiring; verify exportStore handles type 'stitch'
5. [ ] Video verb + StitchedArtifactCard + staleness badge + regenerate
6. [ ] Stitched-artifact exclusion in membership evaluation (+ regression test)
7. [ ] Backend tests: matched-params stream copy, mixed-resolution normalize, staleness diff, exclusion; E2E: stitch a game collection -> pinned card plays

### Progress Log

## Acceptance Criteria

- [ ] Video verb produces a single MP4 named with collection title + ratio word; plays/downloads/shares like any reel
- [ ] Same-params members stream-copy (no re-encode -- verify via codec/bitrate equality in test)
- [ ] Mixed resolution/fps members normalize to canonical resolution for the ratio
- [ ] New member publish or budget change flips the staleness badge; Regenerate replaces (new version)
- [ ] Stitch is free (no credit movement) and capped at 1 concurrent per user
- [ ] Tests pass
