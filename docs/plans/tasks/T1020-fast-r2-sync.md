# T1020: Profile R2 Sync and Make It Faster

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-04-07
**Updated:** 2026-04-07

## Problem

The DB sync middleware uploads SQLite files to R2 after every write request, blocking the HTTP response. This adds 1.7-3s per write in the Frame Video flow:

| Request | Handler | R2 Sync | Total |
|---------|---------|---------|-------|
| saveClipState (PUT /clips) | 30ms | 1,670ms | 1,700ms |
| render POST (POST /export/render) | 31ms | 3,020ms | 4,660ms |

R2 sync accounts for **61% of total Frame Video latency** (4.69s of 7.66s).

## Current Sync Flow

Each sync performs two R2 operations per database (profile.sqlite + potentially user.sqlite):

1. **HEAD request** to R2 to check version metadata (`get_db_version_from_r2`) — version conflict detection
2. **Full file upload** to R2 (`upload_file`) — the entire SQLite file (currently ~160KB)

So a request that writes to both profile.sqlite and user.sqlite does up to **4 R2 round-trips** (2 HEADs + 2 uploads).

### Current file sizes
- `profile.sqlite`: ~160KB (grows with clips/projects/exports)
- `user.sqlite`: ~104KB (credits, settings)
- `auth.sqlite`: ~104KB (synced separately, not per-request)

### What makes the render POST sync slower (3s vs 1.7s)
Needs investigation. Possibly:
- Writes to both profile.sqlite (export_jobs) AND user.sqlite (credit_transactions)
- More data changed = larger write-ahead log before upload
- R2 upload latency variance

## Where to Profile

Add `time.perf_counter()` timing to these steps in `sync_database_to_r2_with_version()` (`storage.py:622`):

1. `check_database_size()` — should be instant (stat call)
2. `get_local_db_version()` — should be instant (in-memory dict)
3. `get_db_version_from_r2()` — HEAD request to R2 (likely ~200-500ms)
4. `retry_r2_call(client.upload_file, ...)` — full file upload (likely ~500-2000ms)

Also profile the middleware level (`db_sync.py:211-240`):
- Time `sync_db_to_cloud_if_writes()` vs `sync_user_db_to_cloud_if_writes()` separately

## Optimization Ideas

### Skip version check when single-device
If we know there's only one active session (no multi-tab/multi-device), the HEAD request is unnecessary — we already know our local version is current. This could cut ~300ms per sync.

### Upload only WAL or diff
SQLite WAL (write-ahead log) contains only the recent changes. Uploading just the WAL and applying it on restore could be much smaller than the full DB. Tradeoff: restore becomes a two-step process.

### Conditional upload (ETag/If-None-Match)
Use R2's conditional upload to combine version check + upload into one round-trip. Upload with a condition that the existing version matches what we expect.

### Compress before upload
gzip the SQLite file before uploading. 160KB compresses to ~40-60KB. Reduces upload time at the cost of CPU (negligible for small files).

### Upload in parallel
When both profile.sqlite and user.sqlite need syncing, upload them concurrently instead of sequentially.

### Cache version locally
Skip HEAD on writes — we already know the version because we track it in-memory (`_local_db_versions` dict). Only HEAD on session start to detect conflicts. This eliminates one R2 round-trip per sync.

## Context

### Relevant Files
- `src/backend/app/storage.py:622` — `sync_database_to_r2_with_version()` (the upload)
- `src/backend/app/storage.py:532` — `get_db_version_from_r2()` (HEAD check)
- `src/backend/app/database.py:1321` — `sync_db_to_cloud()` (orchestrates sync)
- `src/backend/app/database.py:1475` — `sync_user_db_to_cloud_if_writes()` (user.sqlite sync)
- `src/backend/app/middleware/db_sync.py:211` — middleware sync trigger
- `src/backend/app/utils/retry.py` — retry tiers (TIER_1, TIER_2) for R2 calls

### Related Tasks
- T930: Resilient R2 sync (retry logic)
- T950: Version conflict detection
- T1010: Slow fetchProgress (separate bottleneck)

## Implementation

### Steps
1. [ ] Add per-step timing inside `sync_database_to_r2_with_version()`
2. [ ] Add timing to middleware to measure profile vs user DB sync separately
3. [ ] Run Frame Video flow and collect timing data
4. [ ] Identify dominant bottleneck (HEAD vs upload vs both)
5. [ ] Implement the most impactful optimization
6. [ ] Verify total sync time < 500ms

## Acceptance Criteria

- [ ] R2 sync per request < 500ms (down from 1.7-3s)
- [ ] No change to data safety guarantees
- [ ] Version conflict detection still works
