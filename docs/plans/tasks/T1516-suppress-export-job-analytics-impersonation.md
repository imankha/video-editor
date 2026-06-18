# T1516: Suppress Export-Job Analytics During Admin Impersonation

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-06-18
**Updated:** 2026-06-18

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
