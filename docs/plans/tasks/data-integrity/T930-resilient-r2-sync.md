# T930: Resilient R2 Sync — Persist Failure State + Retry

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-04-02
**Depends On:** T920

## Problem

The middleware syncs database.sqlite and user.sqlite to R2 AFTER the HTTP response. Two failure modes cause silent data loss:

### 1. Server crash between DB write and R2 sync

The request handler commits to local SQLite, the response is sent, then the middleware attempts R2 upload. If the server crashes (Fly.io scale-to-zero, deploy, OOM) during or before the upload, the local files are gone and R2 has stale data. On cold start, the stale R2 version is restored — user's last request is silently lost.

### 2. R2 sync fails with no retry

If R2 is unreachable, `sync_database_to_r2_with_version()` catches the exception, logs a warning, and sets `_sync_failed[user_id] = True`. But `_sync_failed` is an in-memory dict — lost on restart. There is no retry queue. The frontend gets `X-Sync-Status: failed` header but subsequent requests don't retry the failed sync.

## Solution

### Step 1: Persist sync failure state

After a failed sync, write a marker file (not in SQLite — that would trigger another sync cycle):

```python
# user_data/{user_id}/.sync_pending
# Contains: timestamp of last failed sync
```

On startup / first request for a user, check for `.sync_pending`. If found, attempt R2 sync before processing the request.

### Step 2: Retry on next request

In the middleware, before `call_next()`:
1. Check if `.sync_pending` exists for this user
2. If yes, attempt R2 sync (both database.sqlite and user.sqlite)
3. If sync succeeds, delete `.sync_pending`
4. If sync fails again, update timestamp, continue (don't block the request)

### Step 3: Sync BEFORE response for critical writes

For credit operations (deduct, reserve, grant), sync to R2 BEFORE returning the response. This narrows the crash window for financial data. Use a decorator or explicit call:

```python
# In the route handler, after credit operation:
from app.database import force_sync_to_r2
force_sync_to_r2()  # Blocks until R2 upload completes or fails
```

Non-financial writes (clip metadata, project names) can keep the async-after-response pattern.

## Relevant Files

- `src/backend/app/middleware/db_sync.py` — write tracking, sync after response
- `src/backend/app/database.py` — sync functions, version tracking
- `src/backend/app/storage.py` — R2 upload functions
- `src/backend/app/session_init.py` — startup initialization (add retry check here)

## Acceptance Criteria

- [ ] Failed sync state persisted to `.sync_pending` marker file
- [ ] Next request for user retries failed sync
- [ ] Successful retry clears `.sync_pending`
- [ ] Credit operations sync to R2 before response (not after)
- [ ] `X-Sync-Status: failed` header still set for frontend
- [ ] No performance regression for non-financial writes
