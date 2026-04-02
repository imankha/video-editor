# T940: Export Worker R2 Sync

**Status:** TESTING
**Impact:** 8
**Complexity:** 2
**Created:** 2026-04-02
**Depends On:** T920

## Problem

The background export worker (`export_worker.py`) runs inside `BackgroundTasks`, outside the request-response lifecycle. Its database writes are never synced to R2:

1. Export job starts → `process_export_job()` runs in background
2. Worker writes to database.sqlite: `INSERT working_videos`, `UPDATE projects`, `UPDATE export_jobs SET status='complete'`
3. Worker uses `get_db_connection()` which returns a `TrackedConnection`
4. TrackedConnection marks `_request_context['has_writes'] = True`
5. BUT `_request_context` is the ContextVar from the original request — which is ALREADY FINISHED
6. Middleware already ran, already checked for writes, already returned the response
7. Worker's writes sit in local SQLite, never synced to R2
8. If server restarts, export results are lost — job shows "complete" in R2's stale DB but working_video doesn't exist

## Solution

Add explicit R2 sync at the end of `process_export_job()`, after all database writes are committed.

```python
# At the end of process_export_job(), after final conn.commit():
try:
    from app.database import sync_db_to_cloud_explicit
    sync_db_to_cloud_explicit(user_id, profile_id)
    logger.info(f"[ExportWorker] Synced database to R2 after export completion")
except Exception as e:
    logger.error(f"[ExportWorker] Failed to sync to R2 after export: {e}")
```

Also sync user.sqlite if the worker does any credit operations (refunds on failure).

### Implementation

1. Add a `sync_db_to_cloud_explicit(user_id, profile_id)` function in `database.py` that doesn't depend on `_request_context` — takes user_id and profile_id as explicit args
2. Call it at the end of `process_export_job()` (success path)
3. Call it at the end of the failure/refund path too
4. Same for user.sqlite if `refund_credits()` was called

## Relevant Files

- `src/backend/app/services/export_worker.py` — background job processing
- `src/backend/app/database.py` — add explicit sync function
- `src/backend/app/storage.py` — R2 upload functions

## Acceptance Criteria

- [ ] Export worker syncs database.sqlite to R2 after job completion
- [ ] Export worker syncs database.sqlite to R2 after job failure
- [ ] Export worker syncs user.sqlite to R2 after credit refund
- [ ] Sync failures logged but don't crash the worker
- [ ] Existing middleware sync still works for request-path writes
