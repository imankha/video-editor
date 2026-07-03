# T4380: ExportJobRepository — One Owner for export_jobs

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-07-03
**Epic:** [export-write-path](EPIC.md) · Audit item E1 · Depends on T4370

## Problem

`export_jobs` has two competing helper layers and 14 raw status-write sites in 5 modules — every stuck/phantom-export bug must be fixed in up to 5 places:

- `routers/exports.py:86` `create_export_job` inserts `status='pending'`; `services/export_helpers.py:37` `create_export_job` (same name!) inserts `status='processing'` **and swallows insert failure with a warning** (:75-76) — a job that failed to record still runs.
- Raw `UPDATE export_jobs SET status=...`: exports.py:144, 157, 173, 261-268, 352-358, 582-585 (inline INSERT bypassing its own helper), 899-903, 989-993; export_worker.py:437; export_helpers.py:98, 121; export/overlay.py:181, 1054, 1089, 1124, 1938; export/multi_clip.py:1293, 1421, 1713, 1812.
- **Inverted layering:** `services/export_worker.py:28-33` imports `get_export_job`/`update_job_*` from the ROUTER module.

## Solution

One `services/export_job_repository.py`:

- `create(cursor, *, project_id, job_type, ...) -> job_id` — ONE initial status (decide 'pending' vs 'processing' by reading both current callers' semantics; record the decision + rationale in the Progress Log). Insert failure RAISES (no swallowing — a job that can't be recorded must not run).
- Transition methods: `start`, `complete`, `fail`, `recover` — each validates the transition (e.g., complete-from-error logs loudly). Status values from `ExportStatus` enum (`constants.py` — extend it if incomplete; note the three failure vocabularies: export_jobs `'error'`, modal_tasks `'failed'`, auto_export `'failed'/'skipped'` — this task unifies export_jobs only; do NOT rename modal_tasks values here).
- Reads: `get(job_id)`, the stale-job query `cleanup_stale_exports` uses.

Then mechanically migrate all 14+ sites (one module per commit; T4370 snapshots must stay identical), fix the worker's import direction, and delete both old helpers.

## Context

- This is behavior-PRESERVING except: (a) swallowed insert failure now raises, (b) the T4240 fixes (if landed) are preserved. If T4240 hasn't landed, coordinate — don't re-break its fixes.
- Verification: after migration, `grep -rn "UPDATE export_jobs\|INSERT INTO export_jobs" src/backend/app --include=*.py` hits only the repository file.

## Steps

1. [ ] Read every write site; table current (site → status written → semantics) in the Progress Log; resolve the pending/processing question.
2. [ ] Repository + unit tests (transitions, raise-on-insert-failure).
3. [ ] Migrate module-by-module against T4370 snapshots (exports.py → export_helpers → worker → overlay → multi_clip).
4. [ ] Delete old helpers; grep-verify single ownership; import check + full backend tests.

## Acceptance Criteria

- [ ] Single owner grep passes; no service→router imports remain
- [ ] Job-record insert failure aborts the export loudly
- [ ] All transitions use ExportStatus enum values
- [ ] T4370 DB-delta snapshots unchanged (except the documented insert-failure behavior)
