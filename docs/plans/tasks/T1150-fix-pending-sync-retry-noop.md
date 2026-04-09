# T1150: Fix Pending Sync Retry (Currently a No-Op)

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

The T930 pending sync retry mechanism is broken — it has been a no-op since it was written.

When an R2 sync fails, the middleware writes a `.sync_pending` marker file. On the **next** request, the middleware checks for this marker and attempts to retry the sync. However, the retry calls `sync_db_to_cloud_if_writes()` and `sync_user_db_to_cloud_if_writes()`, which both check `get_request_has_writes()` before doing anything.

The retry runs at **line 191** of `db_sync.py` — **before** `init_request_context()` at **line 211**. Since the request context hasn't been initialized yet, `_request_context` is `None`, so `get_request_has_writes()` always returns `False`, and both `_if_writes` functions short-circuit to "ok" / `True` without uploading anything.

The retry always "succeeds" (returns ok), clears the pending marker, and logs "Retry succeeded" — but no data was actually uploaded.

### Code path

```
# Line 191 — BEFORE init_request_context()
if has_sync_pending(user_id):
    retry_ok = sync_db_to_cloud_if_writes()    # ← checks has_writes → False → returns "ok"
    user_retry_ok = sync_user_db_to_cloud_if_writes()  # ← same → returns True
    # Both "ok" → clears pending marker → logs success
    # But nothing was uploaded
```

### Impact

If an R2 sync fails (network blip, R2 outage), the data that failed to sync is **never retried**. The pending marker is silently cleared on the next request. The data only reaches R2 if the user makes another write on a subsequent request, which triggers a normal end-of-request sync.

This means a transient R2 failure can cause data to exist only in the local SQLite file until the next write. If the server restarts before another write (or the user switches devices), that data is lost.

## Solution

Replace the `_if_writes` calls in the retry block with direct sync calls that don't check the write flag:

```python
# Line 191
if has_sync_pending(user_id):
    logger.info(f"[SYNC] Retrying pending sync for user {user_id}")
    try:
        retry_ok = sync_db_to_cloud()  # Direct — always syncs
        user_retry_ok = sync_user_db_to_cloud()  # Need to add this function
        ...
```

Or simpler: use the explicit sync functions that the parallel sync path already uses:

```python
if has_sync_pending(user_id):
    try:
        _profile_id = get_current_profile_id()
        profile_ok = sync_db_to_r2_explicit(user_id, _profile_id)
        user_ok = sync_user_db_to_r2_explicit(user_id)
        if profile_ok and user_ok:
            clear_sync_pending(user_id)
            set_sync_failed(user_id, False)
        else:
            logger.warning(f"[SYNC] Retry still failing for user {user_id}")
    except Exception as e:
        logger.warning(f"[SYNC] Retry failed for user {user_id}: {e}")
```

The explicit functions take `user_id`/`profile_id` as args (no ContextVar dependency) and call `sync_database_to_r2_with_version` directly.

## Context

### Relevant Files
- `src/backend/app/middleware/db_sync.py:191` — The broken retry block
- `src/backend/app/database.py:1372` — `sync_db_to_cloud_if_writes()` (the wrong function to call)
- `src/backend/app/database.py:1396` — `sync_db_to_r2_explicit()` (the right function to call)

### Related Tasks
- T930: Resilient R2 sync (introduced the pending retry mechanism)
- T1020: Fast R2 sync (current optimization work)

### How it was found
During conformity audit of the R2 sync strategy for T1020. Traced the retry code path and discovered `_request_context` is `None` when the retry runs because `init_request_context()` hasn't been called yet.

## Acceptance Criteria

- [ ] Pending sync retry actually uploads to R2
- [ ] Retry uses explicit sync functions (no ContextVar dependency)
- [ ] `.sync_pending` marker is only cleared on actual successful upload
- [ ] Test: simulate failed sync → verify retry uploads on next request
