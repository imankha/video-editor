# T2720: Post-Export R2 Sync Stalls All Requests for 14 Seconds

**Status:** TESTING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-11
**Updated:** 2026-05-11

## Problem

After a framing export completes, the framing-to-overlay transition stalls for ~14 seconds. Three requests fired by the frontend immediately after export completion all take 13-14 seconds:

```
[SLOW FETCH] GET /api/projects total=13754ms ttfb=13690ms
[SLOW FETCH] GET /api/quests/progress total=13842ms ttfb=13738ms
[SLOW FETCH] PUT /api/clips/projects/1/clips/1 total=14463ms ttfb=14422ms
```

The user sees nothing during this time -- the framing screen has finished exporting, the overlay screen hasn't loaded, and there's no progress indicator. The stall is 100% server-side (TTFB ~14s).

This also causes a secondary race condition: the overlay screen tries to load before the PUT completes, sees `workingVideoId: null`, and logs errors before retrying:
```
[OverlayScreen] Working video URL still missing after refresh
[OverlayScreen] No video source available {workingVideoId: null}
```
The retry mechanism (T1670 fix) recovers, but the initial errors are noisy and the 14s wait is the real problem.

## Root Cause

The export worker runs `_sync_after_export()` which uploads the full SQLite database to R2. This acquires the per-user upload lock (`threading.Lock`) for ~14 seconds. When the frontend immediately fires requests after export completion, those requests hit the sync middleware which also needs to sync -- they block on the same upload lock, serializing behind the export worker's upload.

### Detailed flow

1. Export worker completes processing (`export_worker.py:180`)
2. Export worker calls `_sync_after_export()` (`export_worker.py:191`) which calls:
   - `sync_db_to_r2_explicit(user_id, profile_id)` -- uploads profile.sqlite
   - `sync_user_db_to_r2_explicit(user_id)` -- uploads user.sqlite
3. Each upload calls `sync_database_to_r2_with_version()` (`storage.py:770-873`)
4. Inside that function, `get_upload_lock(user_id, "profile")` acquires a `threading.Lock` (`storage.py:847-861`)
5. The boto3 `client.upload_file()` runs inside the lock -- blocking for the full upload duration
6. Meanwhile, frontend fires 3 requests through the db_sync middleware
7. The middleware's `_sync_aware_flow()` also needs to upload to R2 after processing
8. It tries to acquire the same upload lock -- blocked for ~14 seconds

### Why 14 seconds?

The upload duration depends on DB size:
- boto3 `upload_file()` with no retries (`"retries": {"max_attempts": 0}`)
- Sync client timeouts: `connect_timeout=3, read_timeout=10` (`storage.py:159`)
- Cold R2 connection: 2-5s per operation
- If the profile DB is 500KB-1MB (working_videos accumulate versions, export_jobs accumulate records), upload takes 10-14s
- The full SQLite file is uploaded every time (no delta sync)

## Context

### Relevant Files

**Export worker:**
- `src/backend/app/services/export_worker.py`
  - Lines 113-143: `_sync_after_export()` -- triggers the blocking R2 upload
  - Lines 169-191: Export completion flow (DB writes then sync)
  - Lines 316-331: DB changes on export completion (INSERT working_videos, UPDATE projects)

**Sync middleware:**
- `src/backend/app/middleware/db_sync.py`
  - Lines 126-128: `WRITE_METHODS`, `_USER_WRITE_LOCKS` definitions
  - Lines 142-158: `_maybe_write_lock()` -- per-user asyncio lock for write serialization
  - Lines 471-479: Write lock wraps `_sync_aware_flow()` (request + R2 sync inside lock)

**R2 upload:**
- `src/backend/app/storage.py`
  - Lines 39-47: `get_upload_lock()` -- per-user `threading.Lock` (synchronous, blocks thread)
  - Lines 770-873: `sync_database_to_r2_with_version()` -- full SQLite upload to R2
  - Lines 847-861: Upload runs inside upload lock, blocking any concurrent sync for same user
  - Line 120: No retries configured (`"retries": {"max_attempts": 0}`)
  - Line 159: Sync client short timeouts (`connect_timeout=3, read_timeout=10`)

**Frontend transition (for context):**
- `src/frontend/src/containers/ExportButtonContainer.jsx`
  - Line 694: "Backend render complete" logged
  - Lines 707-710: Fires clip save + project refresh + overlay transition
- `src/frontend/src/screens/FramingScreen.jsx`
  - Lines 838-930: Overlay transition flow (save clip state, refresh project, navigate)
- `src/frontend/src/screens/OverlayScreen.jsx`
  - Lines 358-371: Working video URL check + retry logic

### Related Tasks
- T2250 (Write-Back R2 Sync) -- TODO, moves R2 sync from blocking-per-gesture to periodic background. Would eliminate this problem entirely.
- T1539 (R2 Concurrent-Write Rate Limit) -- DONE, added the per-user upload lock that's now causing the stall
- T1531 (Quests Achievement 60s Stall) -- DONE, added SKIP_SYNC_PATHS which helps for some endpoints but not these
- T1670 (Overlay Stuck Loading After Export) -- DONE, added retry mechanism that masks the race condition

### Technical Notes

- The write lock (`asyncio.Lock`) and upload lock (`threading.Lock`) are separate locks at different levels. The write lock serializes requests; the upload lock serializes R2 PutObject calls. Both contribute to the stall.
- The export worker runs in a `BackgroundTask` (FastAPI), so it's on a separate thread from the request handlers. The `threading.Lock` in storage.py is what bridges the contention.
- T2250 (Write-Back R2 Sync) is the strategic fix -- it moves ALL R2 syncs to a periodic background task (~3 min). But T2250 is a large task. This task could ship a tactical fix first.

## Solution Options

### Option A: Skip sync on post-export frontend requests (tactical)
The export worker already syncs via `_sync_after_export()`. The middleware doesn't need to sync again for the immediately-following requests. Add the transition endpoints to `SKIP_SYNC_PATHS` or detect "just synced" state.

### Option B: Make _sync_after_export non-blocking to the upload lock
Run the R2 upload in a fire-and-forget thread that doesn't hold the upload lock for the full duration. Use a "sync pending" flag so the middleware knows a sync is in-flight and can skip its own sync.

### Option C: Reduce DB size before upload
Vacuum or prune old working_video versions and completed export_jobs before syncing. Smaller DB = faster upload.

### Option D: Wait for T2250 (Write-Back R2 Sync)
T2250 eliminates per-request sync entirely. But it's a larger task and this stall is user-visible now.

## Implementation

### Steps
1. [x] Measure actual DB size being uploaded (add logging to `sync_database_to_r2_with_version`)
2. [x] Determine which option (A/B/C) gives the best tactical improvement
3. [x] Implement fix
4. [ ] Verify post-export transition completes in <2s
5. [ ] Verify overlay screen loads without "working video URL missing" errors

### Progress Log

**2026-05-11**: Task created from console log analysis during T1190 testing. Observed on localhost with uvicorn. Three requests all stalled ~14s during framing-to-overlay transition. Export itself completed in 320.3s. The stall is server-side (TTFB matches total time). The overlay screen's retry mechanism (T1670) masks the race condition but users still wait 14s.

**2026-05-11**: Implemented Option A variant -- `lock_timeout` parameter on sync functions. When the middleware's post-request R2 sync can't acquire the upload lock within 0.5s (because the export worker holds it), it returns `(False, None)` immediately instead of blocking ~14s. The `sync_pending` marker stays set, so the next request retries. Changes: `storage.py` (2 sync functions), `database.py` (2 explicit wrappers), `middleware/db_sync.py` (4 call sites + constant). 4 tests added to `test_session_pinning.py`.

## Acceptance Criteria

- [ ] Post-export transition (framing to overlay) completes in <3 seconds
- [ ] No "Working video URL still missing" errors in overlay screen
- [ ] Export worker's R2 sync doesn't block concurrent requests
- [ ] No data loss -- export results still survive server restarts
