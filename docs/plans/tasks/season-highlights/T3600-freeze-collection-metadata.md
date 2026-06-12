# T3600: Freeze Collection Metadata at Export

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-06-12

## Problem

`final_videos` carries no `duration`, `aspect_ratio`, or `tags`. Duration is computed per-request via a fallback chain ([downloads.py:462-470](../../../../src/backend/app/routers/downloads.py)) and is NULL when source rows are gone. Every collection feature (ratio-scoped grouping, 30s thresholds, time budgets, tag-based smart collections, the unlock gate, quest detection) needs these as frozen, queryable columns.

## Solution

Stamp all three columns at **export-finalize time** (working data still exists there; publish archives + deletes it -- see EPIC.md decision #4), plus a v007 backfill migration that handles archived projects by reading their R2 msgpack archives.

### Schema (full column mapping)

| Column | Type | Written where | Value source |
|---|---|---|---|
| `duration` | REAL NULL | `_finalize_overlay_export` ([overlay.py:58-108](../../../../src/backend/app/routers/export/overlay.py)); auto_export already writes it ([auto_export.py:197-204](../../../../src/backend/app/services/auto_export.py)) | Existing on-the-fly chain moved to write time: working_videos.duration (latest version) for custom projects; raw_clips end-start for brilliant clips; probed output for auto exports |
| `aspect_ratio` | TEXT NULL | same | `projects.aspect_ratio` of the exporting project |
| `tags` | BLOB NULL (msgpack array of distinct tag strings, via `utils/encoding.py` -- same convention as `rating_counts`) | same | DISTINCT tags of constituent clips: `working_clips -> raw_clips.tags` (raw_clips.tags is already msgpack per T2870) |

### Backfill (inside v007 `up()`)

1. Rows with live source data: compute via the same logic as the stamping code (share one helper; do not duplicate).
2. Published rows whose working data was archived: download + decode `archive/{project_id}.msgpack` (see `services/project_archive.py` restore path, line ~184) and extract working_clips tags / working_videos duration / project aspect_ratio.
3. Rows that still resolve to nothing: leave NULL, log one visible line per row (`[T3600] final_video {id} backfill incomplete`). No silent fallback; downstream features exclude NULL rows from math but still render them.
4. Follow the v004 msgpack-migration pattern (validate before re-pack); migration registered in `migrations/profile_db/__init__.py`; canonical schema in `database.py::ensure_database()` updated in the same PR (fresh DBs skip migrations -- PRAGMA pre-set).

### Indexes (same migration -- EPIC decision #13 groundwork)

`CREATE INDEX IF NOT EXISTS idx_final_videos_published_ratio ON final_videos(published_at, aspect_ratio)` in both v007 and `ensure_database()`. Powers T3610's summary GROUP BY, T3640's 30s gate sum, and T3620's resolver scans without full-table walks.

### Verification edge case (resolve during implementation)

`auto_export.py` hardcodes `source_type='brilliant_clip'` while downloads.py also handles `'annotated_game'`. Locate the `'annotated_game'` insert site (if any remains live) and stamp it too. Document the finding in this file's Progress Log.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/export/overlay.py` - `_finalize_overlay_export` INSERT (line 58-108): add 3 columns
- `src/backend/app/services/auto_export.py` - auto export INSERT (line 197-204): add aspect_ratio + tags
- `src/backend/app/database.py` - `ensure_database()` final_videos CREATE TABLE: add columns
- `src/backend/app/migrations/profile_db/__init__.py` - register v007
- `src/backend/app/migrations/profile_db/v007_collection_metadata.py` - NEW migration + backfill
- `src/backend/app/services/project_archive.py` - reuse archive download/decode for backfill
- `src/backend/app/routers/downloads.py` - DownloadItem gains duration/aspect_ratio/tags from columns; keep on-the-fly chain ONLY as the shared helper the backfill uses
- `src/backend/app/utils/encoding.py` - encode_data/decode_data for tags

### Related Tasks
- Blocks: T3610 (ratio pills, group durations), T3620 (viewer durations), T3640 (30s unlock gate, time budget), T3660 (publish_30s quest step), T3670 (tag eligibility), T3680 (stitch grouping)
- Reuses: T2870's msgpack-column conventions; T2600's archive msgpack format

### Technical Notes
- Persistence/sync/migration mechanics: tech-notes sections 1-3. Writes auto-sync to R2 via middleware; migrations are commit-free inside `up()`; never auto-run (admin endpoint).
- Backfill downloads R2 archives -- keep it resilient: per-row try/except with logging, never abort the whole migration on one bad archive.
- Include the **Migration agent** in classification (schema change).

## Implementation

### Steps
1. [ ] Add columns to `ensure_database()` schema
2. [ ] Extract shared metadata-computation helper (duration chain + aspect lookup + tag aggregation)
3. [ ] Stamp in `_finalize_overlay_export` and auto_export insert paths
4. [ ] Locate/stamp the annotated_game insert site (or document that it is auto_export)
5. [ ] Write v007 migration with archive-aware backfill + published/ratio index; register it
6. [ ] Surface new fields in GET /api/downloads response model
7. [ ] Backend tests: stamping on export, backfill with live data, backfill from archive, NULL-resilience

### Progress Log

## Acceptance Criteria

- [ ] New exports produce final_videos rows with duration, aspect_ratio, tags populated
- [ ] v007 backfills existing rows, including published reels whose projects are archived
- [ ] Rows that cannot be backfilled stay NULL with a visible log line
- [ ] GET /api/downloads returns the three fields
- [ ] Backend tests pass (`run_tests.py` -- warn user: tests truncate dev Postgres)
