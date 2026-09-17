# T4380: ExportJobRepository — One Owner for export_jobs

**Status:** STAGING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-07-03
**Updated:** 2026-09-17
**Epic:** [export-write-path](EPIC.md) · Audit item E1 · Depends on T4370

**2026-09-17: spawned via /dotask** (container `reel-task-t4380`, branch
`feature/T4380-export-job-repository`) immediately after T4370 merged (PR #455). Merged PR #456
(Branch CI green, reviewer caught + fixed 1 real MAJOR bug, 178/178 tests). **Unlocks T4390**
(next in strict order).

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

1. [x] Read every write site; table current (site → status written → semantics) in the Progress Log; resolve the pending/processing question.
2. [x] Repository + unit tests (transitions, raise-on-insert-failure).
3. [x] Migrate module-by-module against T4370 snapshots (exports.py → export_finalize.py [scope addition] → export_helpers → worker → overlay → multi_clip).
4. [x] Delete old helpers; grep-verify single ownership; import check + full backend tests.

## Acceptance Criteria

- [x] Single owner grep passes; no service→router imports remain — `grep -rn
  "UPDATE export_jobs\|INSERT INTO export_jobs" src/backend/app --include=*.py`
  hits ONLY `services/export_job_repository.py` (plus `migrations/profile_db/
  v028_export_job_stages.py`, excluded per the documented migration-file rule).
  `export_worker.py` no longer imports from any router (confirmed by grep).
- [x] Job-record insert failure aborts the export loudly — `create()`/
  `create_if_none_active()` have no try/except; a DB error propagates.
- [x] All transitions use ExportStatus enum values — every status literal in
  `export_job_repository.py` is `ExportStatus.<MEMBER>.value`.
- [x] T4370 DB-delta snapshots unchanged (except the documented insert-failure
  behavior) — golden harness re-run green after every module commit (see
  Progress Log); final full run in the QA phase.

## Progress Log

**2026-09-17 — Code Expert site audit (Step 1) complete.** Full write-site table (31 sites,
re-verified current line numbers) built by a code-expert pass. Two findings resolved before
writing any repository code:

1. **Initial status: `'pending'`, not `'processing'` — evidenced, not a preference.**
   `export_worker.py:156` (`process_export_job`) hard-gates on `if job['status'] != 'pending':
   return` — any job handed to the async worker (`/exports/start` → `exports.py:95
   create_export_job`, and `/exports/framing`'s inline INSERT at `exports.py:605`) MUST be
   inserted as `'pending'` or the worker refuses to run it (total export break). The dead
   `export_helpers.py:35 create_export_job` (inserts `'processing'`, swallows insert failure,
   **zero live callers** — confirmed by repo-wide grep) is the one being replaced; its
   `'processing'` value was never load-bearing anywhere, it was simply never exercised.
   `insert_export_job_if_none_active` (`export_helpers.py:79`, T9540) is a THIRD, separate
   creation path used by the synchronous inline-render endpoints (framing/overlay/multi-clip
   render routes) — those never go through `process_export_job`, so they legitimately insert
   `'processing'` directly (they ARE the worker for that request). Repository decision:
   `create()` defaults to `'pending'`; the atomic if-none-active path gets its own repository
   method (`create_if_none_active`, same INSERT...SELECT...WHERE NOT EXISTS semantics, still
   raises on failure) rather than collapsing both into one method with a status parameter that
   could be misused.

2. **Scope correction (required by the acceptance criterion, not a design change).** The task's
   Problem section names 5 modules, but the audit found `services/export_finalize.py`
   (`_set_export_stage`, `_claim_stage_for_finalize`, and the `finalize_export` success/error
   paths — lines ~50/75/279/393) also writes raw `UPDATE export_jobs` directly, and is called by
   TWO of the five in-scope modules (`exports.py`'s recovery path, `multi_clip.py`'s Modal
   branch). The literal acceptance criterion — `grep -rn "UPDATE export_jobs\|INSERT INTO
   export_jobs" src/backend/app --include=*.py` hits only the repository file — mechanically
   fails if this file's SQL isn't migrated too; this isn't a two-way judgment call (no plausible
   reading of "single owner" excludes it), so it's being folded in as an additional
   mechanical-migration commit rather than a BLOCKED stop. Inserted into the migration order
   right after `exports.py` (its first/direct consumer): **exports.py → export_finalize.py →
   export_helpers.py → worker → overlay → multi_clip**.
   - `export_helpers.py` itself is NOT fully deleted at Step 4: `insert_export_job_if_none_active`,
     `fail_export_job`, `derive_project_name`, `resolve_clip_source`, etc. are still called by
     `routers/export/framing.py` (confirmed via import grep), which is explicitly out of this
     task's scope. Those functions stay as thin wrappers delegating to the new repository
     (satisfies the grep with zero behavior/signature change for framing.py). Only the dead
     `create_export_job` (and any other function that ends up with zero callers post-migration)
     gets deleted.
   - `stage`/`output_key` checkpoint writes (`ExportStage`, T5630/T7210 CAS) are a distinct
     durable-checkpoint concern, not a status transition — kept as separate repository read/write
     methods, not folded into `start`/`complete`/`fail`/`recover`.
   - `acknowledged_at` writes and `modal_call_id` recovery writes are not status transitions
     either; repository exposes them as their own methods.
   - Existing per-module `'error'`-marking `except: pass`/warning-log blocks (overlay.py
     :1727/:1762/:2840, multi_clip.py :2029, export_finalize.py :393) stay swallowing — the
     task's "insert failure now raises" is narrow to job-record *creation*, not to an
     already-in-a-failure-handler status update. Only insert-time swallowing changes.
   - Migration files (e.g. `v028_export_job_stages.py`) are excluded from the single-owner grep
     — they run pre-repository against arbitrary historical schema.

**2026-09-17 — Reviewer pass (fresh-context) found one MAJOR before merge.** `overlay.py:1511`'s
local-render tracking INSERT (`export_overlay_only`) was migrated onto `create()` (status=
`pending`) instead of preserving its original `'processing'` — a real byte-level DB change,
inconsistent with this file's own decision #1 above (synchronous inline-render endpoints insert
`'processing'`). That site has no in-flight guard in its original code, so reusing
`create_if_none_active` would have silently added dedup semantics that were never there. Fixed by
adding `create_processing()` — an unconditional plain INSERT as `PROCESSING`, no guard — and
pointing that one call site at it. New unit test (`test_create_processing_inserts_processing_
unconditionally`) locks the no-guard property. Two MINOR notes accepted as-is (a pre-existing
swallow wrapper around that same call site, and an undocumented-but-verified-safe `get()`
column-narrowing in the worker) — see reviewer transcript for detail; no code change needed.

**2026-09-17 — QA phase (final).** Evidence mapped to every Acceptance Criterion:

| Acceptance criterion | Evidence |
|---|---|
| Single owner grep passes; no service→router imports remain | `grep -rn "UPDATE export_jobs\|INSERT INTO export_jobs" src/backend/app --include=*.py` → only `export_job_repository.py` (+ excluded `v028_export_job_stages.py`); `grep -n "from.*routers" app/services/export_worker.py` → no matches |
| Job-record insert failure aborts the export loudly | `create()`/`create_if_none_active()`/`create_processing()` have no try/except in the repository; `test_create_raises_on_insert_failure` proves it via a forced PK collision |
| All transitions use ExportStatus enum values | Every status literal in `export_job_repository.py` is `ExportStatus.<MEMBER>.value`, verified by reading the file |
| T4370 DB-delta snapshots unchanged (except the documented insert-failure behavior) | Golden harness (`test_export_golden_{local_render,overlay,multiclip_modal,worker,sweep,render}.py`) run green after EVERY module commit (6 commits) and once more in final QA — 9/9 each time |

Full QA sweep (golden harness + repository's own 24 unit tests + the curated relevant set —
`test_t4350_carry_finalize`, `test_t4355_multiclip_carry`, `test_t5630_characterization`,
`test_t5630_finalize_unit`, `test_t7210_modal_call_id_recovery`, `test_export_worker_sync`,
`test_auto_export`, `test_t4110_export_durability`, `test_t4120_test_seams`,
`test_t9540_double_dispatch_guard`, plus `test_t4240_export_recovery` and 2 overlay tests touched
by the migration): **178/178 passed**. `python3 -c "from app.main import app"` clean. `ruff check`
clean on every touched file (one pre-existing, unrelated import-order lint hit in
`test_t4240_export_recovery.py` outside the edited region — left alone).

CI verdict: not yet run (local sweep only, pending push).
