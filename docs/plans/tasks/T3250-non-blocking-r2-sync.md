# T3250: Non-Blocking R2 Sync in Write Lock

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Created:** 2026-06-01
**Updated:** 2026-06-01

## Problem

The per-user write lock in the db_sync middleware holds for the **entire request lifecycle**: handler execution + R2 sync. R2 sync takes 500-800ms per write. When a user triggers rapid writes (e.g., navigating between projects, each firing `PATCH /projects/{id}/state`), requests serialize on the lock. Each queued request waits for the previous handler + sync to complete before it can start.

**Observed on prod (2026-05-31):** User rapidly opened projects 7, 6, 5, 4, 3. Each triggered a `PATCH /state` write. The accumulated queue caused:
- `PATCH /projects/6/state` response time: **420 seconds**
- `POST /actions` response times: **360-398 seconds**
- `DELETE /projects/3` response time: **115 seconds**
- UI stuck on "Loading reel drafts..." for ~2 minutes

The write lock protects SQLite consistency (two concurrent writes must not interleave). But the R2 sync is a **read** of the SQLite file followed by an upload -- it doesn't need the write lock.

## Solution

Narrow the write lock scope: hold it only during handler execution, release it before R2 sync. Fire R2 sync as a background task immediately after the response returns.

**What changes:**
- Write lock protects: SQLite handler only (~10-50ms)
- Write lock does NOT protect: R2 sync (~500-800ms)
- R2 sync still fires after every write (no debounce, no batching)
- Upload lock (per-user threading.Lock in storage.py) still serializes concurrent R2 uploads
- `mark_sync_pending` still set before sync attempt for crash recovery
- `clear_sync_pending` still cleared on sync success

**What doesn't change:**
- Every write triggers a sync (no skipping, no debounce)
- Version-based upload with version++ on each sync
- Upload lock prevents concurrent PutObject to same R2 key
- Crash recovery via `mark_sync_pending` marker files
- `SKIP_SYNC_PATHS` for achievement routes
- Retry logic for pending syncs on next write request

### Sequence: Before vs After

**Before (current):**
```
Request 1 (PATCH):  [--- write lock --------------------------------]
                    [handler 50ms] [R2 sync 600ms]
Request 2 (PATCH):                                  [--- write lock --------------------------------]
                                                    [handler 50ms] [R2 sync 600ms]
Request 3 (DELETE):                                                                  [--- write lock ---...
                                                                                     [handler 50ms] ...

Total wall-clock for Request 3: ~1300ms queue + 650ms own = ~1950ms
```

**After (proposed):**
```
Request 1 (PATCH):  [lock 50ms] → response returns → [R2 sync 600ms (background)]
Request 2 (PATCH):              [lock 50ms] → response returns → [R2 sync 600ms (background, queued behind upload lock)]
Request 3 (DELETE):                          [lock 50ms] → response returns → [R2 sync 600ms (background)]

Total wall-clock for Request 3: ~100ms queue + 50ms own = ~150ms
```

### Safety Analysis

| Concern | Mitigation |
|---------|------------|
| Server crashes before background sync completes | `mark_sync_pending` is set BEFORE response returns; next request retries sync |
| Two background syncs race on R2 PutObject | Upload lock (threading.Lock per user+key) serializes them; version metadata prevents regression |
| Background sync reads SQLite while next handler writes | SQLite WAL mode handles concurrent read+write; sync reads a consistent snapshot |
| Sync failure not surfaced to user | `X-Sync-Status` header still works -- `is_sync_failed()` checks marker file, surfaced on next request |
| Background task outlives request context | Capture `user_id`, `profile_id` as local variables (already done for `asyncio.to_thread` calls) |

## Context

### Relevant Files

**Primary changes:**
- `src/backend/app/middleware/db_sync.py` -- Restructure `_sync_aware_flow()` and `_maybe_write_lock()` so the lock releases before sync; fire sync as background task
  - Lines 180-196: `_maybe_write_lock()` -- currently wraps entire `_sync_aware_flow()`
  - Lines 524-532: Lock acquisition in `dispatch()` -- wraps handler + sync
  - Lines 536-745: `_sync_aware_flow()` -- handler execution + sync logic interleaved
  - Lines 598-724: Post-handler sync block -- needs to move to background

**Documentation updates:**
- `src/backend/.claude/skills/persistence-model/SKILL.md` -- Update architecture diagram and `sync-on-mutation` description
- `src/backend/.claude/skills/persistence-model/rules/sync-r2-always.md` -- Update implementation pseudo-code (currently shows sync inside response lifecycle)
- `CLAUDE.md` -- No changes needed (doesn't describe sync timing)
- `src/backend/CLAUDE.md` -- No changes needed

**No changes needed:**
- `src/backend/app/storage.py` -- Upload lock and sync functions unchanged
- `src/backend/app/database.py` -- TrackedConnection and write detection unchanged
- Frontend code -- No changes; responses simply arrive faster

### Related Tasks

- **T2720** (Post-Export R2 Sync Stall) -- DONE. Added `lock_timeout` on upload lock so middleware doesn't block behind export worker's upload. This task addresses a different bottleneck: the write lock itself.
- **T1539** (R2 Concurrent-Write Rate Limit) -- DONE. Added per-user upload lock in storage.py. That lock remains unchanged and continues to serialize R2 uploads.
- **T1531** (Quests Achievement 60s Stall) -- DONE. Added `SKIP_SYNC_PATHS`. Orthogonal to this change.
- **T1538** (Per-Resource Locks) -- DONE. Explored handler-level parallelism; concluded write lock contention evidence hadn't materialized. This task IS that evidence.

### Technical Notes

**Why not debounce:** Debouncing creates a window where committed SQLite writes haven't synced to R2. If the server crashes during that window, data is lost. Every write must trigger a sync -- the question is only whether the HTTP response waits for it.

**Background task mechanism:** Use `asyncio.create_task()` to fire the sync coroutine after returning the response. The task runs on the event loop and calls `asyncio.to_thread()` for the blocking boto3 upload (same pattern as today, just not awaited inline). Alternatively, use Starlette's `BackgroundTask` on the response object.

**Write lock still needed:** Without the write lock, two concurrent POST requests could interleave SQLite operations (e.g., both read version N, both write version N+1, one overwrites the other). The lock serializes handlers so SQLite operations are atomic per-user. It just doesn't need to cover the R2 upload.

**Starlette BackgroundTask vs asyncio.create_task:** Starlette's `BackgroundTask` runs after the response is sent and is tied to the response lifecycle. `asyncio.create_task` is more flexible but requires manual error handling. Either works; BackgroundTask is the more idiomatic Starlette approach and is already used by the export worker.

## Implementation

### Steps

1. [ ] Restructure `_sync_aware_flow()` to separate handler execution from sync logic
2. [ ] Move sync block (lines 598-724) into a standalone async function that can run independently
3. [ ] Change `dispatch()` so write lock wraps only the handler call, not the sync
4. [ ] Fire sync as a background task (Starlette `BackgroundTask` or `asyncio.create_task`) after response
5. [ ] Ensure `mark_sync_pending` is called BEFORE releasing the write lock (crash safety)
6. [ ] Preserve error-path sync (lines 747-777) -- if handler raises, still attempt sync in background
7. [ ] Update persistence-model skill: architecture diagram, `sync-on-mutation` rule, `sync-r2-always` rule
8. [ ] Add/update `[WRITE_LOCK_WAIT]` logging to measure improvement
9. [ ] Test: rapid writes no longer queue (mock R2 upload with delay, verify response times)
10. [ ] Test: sync failure sets `mark_sync_pending`, next request retries
11. [ ] Test: concurrent background syncs serialize on upload lock (no version regression)

### Progress Log

**2026-06-01**: Task created from prod incident analysis. User rapidly navigated projects causing write lock queue. DELETE /projects/3 waited 115s behind queued PATCH/POST syncs. HAR confirmed 420s PATCH response times. Root cause: write lock held during R2 sync (~600ms each), serializing all writes per user.

## Acceptance Criteria

- [ ] Write requests return in <200ms regardless of R2 sync duration
- [ ] R2 sync still fires after every write (no data loss window beyond crash recovery)
- [ ] `mark_sync_pending` set before response returns (crash safety)
- [ ] Background sync failures surface via `X-Sync-Status` header on next request
- [ ] Upload lock still prevents concurrent R2 PutObject (no version regression)
- [ ] Existing tests pass (test_session_pinning.py sync tests)
- [ ] persistence-model skill docs updated to reflect non-blocking sync
