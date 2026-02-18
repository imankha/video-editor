# T87: Handle Sync Connection Loss Gracefully

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-02-17
**Updated:** 2026-02-17

## Problem

The DB sync middleware (`db_sync.py`) syncs the local SQLite database to R2 after every write request. If R2 is unreachable during sync:

1. The HTTP response has already been sent to the client (writes committed locally)
2. The R2 upload fails silently (logged but not surfaced)
3. Local and R2 databases diverge
4. On next request, the system won't re-sync because it only checks R2 on first access (`local_version is None`)

This means a single network blip during sync can cause permanent divergence until the user clears local state or gets a fresh session.

## Solution

Improve sync resilience:

1. **Retry failed syncs** - If R2 upload fails, queue a retry on the next write request (not just first access)
2. **Track sync status** - Add a `last_sync_failed` flag so the system knows it's out of sync
3. **Periodic re-sync check** - On write requests, if `last_sync_failed` is true, attempt sync again before the new write
4. **Surface sync failures** - Return a header or response field so the frontend can warn the user

## Context

### Relevant Files
- `src/backend/app/middleware/db_sync.py:79-102` - Sync after response, catches errors silently
- `src/backend/app/database.py:415-425` - First-access-only R2 check (optimization to avoid 20s+ cold HEAD)
- `src/backend/app/storage.py:485+` - `sync_database_to_r2_with_version()` - the actual upload
- `src/backend/app/database.py:1049` - "Failed to sync database to R2" error log

### Technical Notes
- The first-access-only check is an intentional optimization (R2 HEAD is 20s+ when cold)
- T40 (Stale Session Detection) addresses the multi-device conflict case but is a larger feature
- This task focuses narrowly on: single-device sync reliability after network failures
- Could use an in-memory flag per user_id to track `needs_resync`

### Related Tasks
- T40: Stale Session Detection (broader multi-device sync, post-launch)
- T243: Archive DB Not Reducing Size (large DB = slower syncs = more failure risk)

## Implementation

### Steps
1. [ ] Add per-user `sync_failed` tracking (in-memory dict or similar)
2. [ ] On sync failure in middleware, set `sync_failed[user_id] = True`
3. [ ] On next write request, if `sync_failed[user_id]`, retry sync before processing
4. [ ] Clear flag on successful sync
5. [ ] Add response header `X-Sync-Status: failed` when sync fails so frontend can warn
6. [ ] Run backend tests

## Acceptance Criteria

- [ ] Failed R2 syncs are retried on next write request
- [ ] Sync status tracked per user
- [ ] Frontend receives notification when sync is degraded
- [ ] No performance regression on happy path (no extra R2 calls when sync is healthy)
- [ ] Backend tests pass
