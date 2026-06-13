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
1. [x] Add columns to `ensure_database()` schema
2. [x] Extract shared metadata-computation helper (duration chain + aspect lookup + tag aggregation)
3. [x] Stamp in `_finalize_overlay_export` and auto_export insert paths (+ third site: `export_final`)
4. [x] Locate/stamp the annotated_game insert site (documented: no live insert site exists — legacy-only)
5. [x] Write v007 migration with archive-aware backfill + published/ratio index; register it
6. [x] Surface new fields in GET /api/downloads response model
7. [x] Backend tests: stamping on export, backfill with live data, backfill from archive, NULL-resilience

### Progress Log

**2026-06-12 — Implementation complete (feature/T3600-freeze-collection-metadata)**

- **annotated_game finding (verification edge case resolved):** `source_type='annotated_game'`
  has NO live insert site. It exists only in `constants.py` (`SourceType.ANNOTATED_GAME` enum)
  and read-side handling in `downloads.py`. The feature was planned but never implemented;
  any such rows are legacy-only. The v007 backfill handles them via the generic path (they
  have `project_id IS NULL`, so they log `[T3600] final_video {id} backfill incomplete
  (no project_id)` and stay NULL). No stamping needed.
- **Third insert site found and stamped:** the task file listed two insert paths, but
  `export_final` (POST /final, overlay.py ~line 1140) is a third live `INSERT INTO
  final_videos`. All three now stamp duration/aspect_ratio/tags.
- **Shared helper:** `app/services/collection_metadata.py` — `compute_project_metadata`
  (live rows), `compute_archive_metadata` (R2 archive dicts), `encode_distinct_tags`.
  Used by both stamping paths and the v007 backfill.
- **Archive reads:** extracted `load_archive()` from `restore_project()` in
  `project_archive.py`; both restore and the backfill share it. raw_clips survive archival,
  so tags resolve through live raw_clips even for archived projects.
- **Deploy-window shim (Reviewer MAJOR 1):** `GET /api/downloads` selects the new columns,
  which would have 500'd every existing user's gallery between deploy and
  `POST /api/admin/migrate`. Fix: temporary idempotent `ALTER TABLE` shim in
  `ensure_database()` (same precedent as the removed T1583/T2870/T2847 in-place fixups) —
  columns exist at deploy time, v007 remains the canonical migration + backfill.
  **Remove the shim once v007 has run on staging + prod.** The
  `idx_final_videos_published_ratio` index is created unconditionally (safe because the
  shim guarantees the columns) and also in v007.
- **downloads.py:** the per-request duration fallback chain (T56) is removed; duration now
  reads from the frozen column. `DownloadItem` gains `aspect_ratio` and `tags`.
- **Review round (Reviewer + Migration agents):** Migration agent passed v007 on all 5
  convention checks. Reviewer raised 2 MAJOR (deploy-window 500s -> shim above;
  annotated_game rows losing resolvable duration -> backfill now computes rated-clip sums
  via `compute_annotated_game_metadata`) and 2 MINOR (archive consult condition includes
  aspect_ratio; auto_export uses the shared helper instead of a bespoke block). All four
  accepted and implemented.
- **Full suite:** 1287 passed; 28 failures + 12 errors are pre-existing on master
  (verified by running the same subset on master), 1 Stripe test is order-dependent
  flaky (passes in isolation). Zero T3600 regressions.
- **Tests:** `tests/test_collection_metadata.py` (16 tests: helper, all stamping paths,
  v007 columns/index/backfill live+archive/NULL-resilience/per-row isolation, downloads
  response). Also updated `test_auto_export.py` fixture (projects table + new columns) and
  stale version counts in `test_migrations.py` (profile_db 6→7; postgres 13→15 was already
  stale on master).

## Acceptance Criteria

- [ ] New exports produce final_videos rows with duration, aspect_ratio, tags populated
- [ ] v007 backfills existing rows, including published reels whose projects are archived
- [ ] Rows that cannot be backfilled stay NULL with a visible log line
- [ ] GET /api/downloads returns the three fields
- [ ] Backend tests pass (`run_tests.py` -- warn user: tests truncate dev Postgres)
