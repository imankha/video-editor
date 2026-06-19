# T1516: Suppress Export-Job Analytics During Admin Impersonation

**Status:** Won't Do (closed 2026-06-19 — implemented + verified, de-prioritized)
**Impact:** 4
**Complexity:** 2
**Created:** 2026-06-18
**Updated:** 2026-06-19

## Problem

T1515 (DONE) made admin impersonation invisible to analytics on the **request path** via a
request-scoped `_current_impersonator_id` ContextVar. That ContextVar is set in the db_sync
middleware and read by `record_milestone()`/`update_session()`/`close_session()`.

The export-completion milestones (`export_completed`, `export_failed`) do **not** fire on the
request — they fire from the **background export worker**
([export_worker.py](../../src/backend/app/workers/export_worker.py)), where the request ContextVar
is unset. So an export *started while impersonating* still records `export_completed` against the
**impersonated user** when it finishes, polluting the lifecycle/funnel/viewer data T1515 was
meant to protect.

This is the explicitly-deferred criterion #5 of T1515 (design approach (a) was preferred but not
built; no out-of-scope note shipped either).

## Solution (approach a — stamp + skip)

1. **Stamp at job creation.** When an export job is created during an impersonated session, set an
   `impersonated` flag on the job row. The request context IS available at creation time, so read
   `get_current_impersonator_id()` (from `user_context.py`) there.
2. **Skip on completion.** In the export worker, when `impersonated` is truthy on the job, skip the
   `record_milestone("export_completed"/"export_failed", ...)` calls (log a debug line, consistent
   with T1515's suppression logging). All other completion work (file output, status update) is
   unaffected.

## Context

### Relevant Files
- `src/backend/app/workers/export_worker.py` — `record_milestone` calls for `export_completed` /
  `export_failed` (the skip point).
- `src/backend/app/database.py` — `export_jobs` table schema (add `impersonated` column, default 0).
- export-job creation path (the endpoint/service that inserts the `export_jobs` row) — set
  `impersonated` from `get_current_impersonator_id()` at creation.
- `src/backend/app/user_context.py` — reuse T1515's `get_current_impersonator_id()` getter.

### Related Tasks
- Follow-up to **T1515 (DONE)** — reuses its `_current_impersonator_id` ContextVar + suppression
  logging pattern. Do not rebuild the request-path guards; this task only adds the background-worker
  path.
- T1510 (DONE) — impersonation session source of truth.

### Migration
- Adds `impersonated` column to `export_jobs` (per-user SQLite / profile DB — confirm which track
  owns `export_jobs`). Include the Migration agent: write a versioned migration + update the
  `CREATE TABLE` schema for fresh DBs. Default existing rows to 0 (not impersonated).

## Acceptance Criteria
- [ ] `export_jobs` has an `impersonated` flag, set true when the job is created during impersonation.
- [ ] Export worker skips `export_completed` / `export_failed` milestones when the job is impersonated (debug-logged).
- [ ] Non-impersonated exports record completion milestones as before.
- [ ] Migration adds the column (versioned + schema DDL); existing rows default to not-impersonated.
- [ ] Tests: an export created while impersonating records no completion milestone; a normal export still does.

## Progress Log

**2026-06-19 — Closed WON'T-DO (implemented + verified, then de-prioritized).**

Approach (a) was fully implemented on branch `feature/T1516-suppress-export-analytics-impersonation`
and **verified working**, then abandoned because it isn't currently needed (the user will impersonate
on staging with replicated accounts instead). The branch was deleted; this record preserves the proven
approach for future revival.

What was built (all verified before abandoning):
- `export_jobs.impersonated INTEGER NOT NULL DEFAULT 0` — added to the CREATE TABLE DDL
  (`database.py`) and a versioned **profile_db v011** migration (`v011_add_export_jobs_impersonated.py`).
- Stamped `1 if get_current_impersonator_id() else 0` at all 7 request-initiated creation sites
  (the framing `pending` paths in `exports.py` are the ones the worker consumes; the `processing`
  sites stamped for correctness). `get_export_job()` projection extended with `e.impersonated`.
- Worker (`export_worker.py`) skips its completion milestones (`export_completed`, `framing_exported`,
  `export_failed`) when `job['impersonated']` is truthy, debug-logged in T1515's style. (Note: this
  guarded `framing_exported` too — a superset of the stated criteria, since it's the same worker-fired
  pollution.)
- Backend tests in `test_t1516_impersonation_export_analytics.py` (creation stamping, worker skip on
  success + failure, normal exports still record, v011 column-add + default). All passed.
- **Live verification on dev:** impersonated hello@reelballers.com, ran an overlay export; Postgres
  confirmed NO `export_completed`/`overlay_exported` recorded and `last_active_at` stayed frozen at
  the pre-impersonation logout — i.e. the impersonation session left no analytics footprint.

To revive: re-implement from the bullets above (the deleted branch was the only copy of the code),
then run v011 via `POST /api/admin/migrate` per environment after deploy.

**Out of scope (do not conflate):** a blank reels-home after an overlay export, seen *only while
impersonating*, was investigated at length and traced to a `_resetDataStores()` -> `projectsStore.reset()`
race exposed by T3775 (`ProjectContext.project = selectedProject`). It is an impersonation-only local
artifact, not user-facing in normal flows, and unrelated to this task. If staging ever shows it without
impersonating, the clean fix lives in `ProjectContext`/an error boundary — open a separate task.
