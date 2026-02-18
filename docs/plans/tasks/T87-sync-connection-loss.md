# T87: Handle Sync Connection Loss Gracefully

**Status:** TESTING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-02-17
**Updated:** 2026-02-18

## Problem

The DB sync middleware (`db_sync.py`) syncs the local SQLite database to R2 after every write request. If R2 is unreachable during sync:

1. The HTTP response has already been sent to the client (writes committed locally)
2. The R2 upload fails silently (logged but not surfaced)
3. Local and R2 databases diverge
4. On next request, the system won't re-sync because it only checks R2 on first access (`local_version is None`)

This means a single network blip during sync can cause permanent divergence until the user clears local state or gets a fresh session.

## Design Decisions

### Don't block writes
Local writes are still consistent (SQLite handles that). The sync is a full DB file upload — if 5 writes happen while sync is failed, the next successful sync uploads everything. Blocking the UI for a transient network blip creates bad UX for a narrow risk (local storage loss while sync is also failed).

### No background processes
No cron jobs, no timers, no polling. Everything stays in the gesture-to-endpoint request/response flow. Transparent systems are less buggy and easier to debug than black boxes.

### Two retry paths
1. **Automatic** — every user write gesture retries the sync as a side effect (already in the middleware flow)
2. **Manual** — a dedicated retry button so the user can explicitly trigger a sync attempt

## Solution

### Backend
1. **Track sync status** — in-memory `sync_failed` dict keyed by user_id
2. **Set flag on failure** — when R2 upload fails in middleware, set `sync_failed[user_id] = True`
3. **Retry on every write** — on subsequent write requests, the existing middleware already attempts sync; if it succeeds, clear the flag
4. **Manual retry endpoint** — `POST /api/retry-sync` that triggers a sync attempt and clears the flag on success
5. **Surface status via header** — return `X-Sync-Status: failed` header on all responses when the flag is set, so frontend can react

### Frontend
1. **Read sync status** — intercept `X-Sync-Status` header from API responses (e.g., in the fetch wrapper or axios interceptor)
2. **Store in Zustand** — `syncFailed: boolean` in a global store
3. **Show indicator** — small yellow warning indicator, fixed position (top bar or bottom corner), visible but not blocking
4. **Indicator is a button** — text like "Sync failed — click to retry", calls `POST /api/retry-sync`
5. **Auto-clear** — on any successful response without the `X-Sync-Status: failed` header, clear `syncFailed` and hide the indicator

## Context

### Relevant Files
- `src/backend/app/middleware/db_sync.py` — sync after response, catches errors silently
- `src/backend/app/database.py:414-425` — first-access-only R2 check (optimization, R2 HEAD is 20s+ cold)
- `src/backend/app/storage.py:485+` — `sync_database_to_r2_with_version()` — the actual upload
- `src/backend/app/database.py:1049` — "Failed to sync database to R2" error log

### Sync Architecture (Current)
- **Down from R2:** Once per session, on first access only (`local_version is None`)
- **Up to R2:** After every write request via middleware (full SQLite file upload)
- Single-device assumption — multi-device sync deferred to T200/T40

### Technical Notes
- The first-access-only check is an intentional optimization (R2 HEAD is 20s+ when cold)
- T40 (Stale Session Detection) addresses the multi-device conflict case but is a larger feature
- This task focuses narrowly on: single-device sync reliability after network failures

### Related Tasks
- T40: Stale Session Detection (broader multi-device sync, post-launch)
- T243: Archive DB Not Reducing Size (large DB = slower syncs = more failure risk)

## Implementation Steps

### Backend
1. [ ] Add `_sync_failed: dict[str, bool]` in-memory tracking to `db_sync.py` or `database.py`
2. [ ] On sync failure in middleware, set `_sync_failed[user_id] = True`
3. [ ] On successful sync, set `_sync_failed[user_id] = False`
4. [ ] Add `X-Sync-Status: failed` response header when flag is set
5. [ ] Add `POST /api/retry-sync` endpoint that triggers sync and returns success/failure
6. [ ] Backend tests

### Frontend
7. [ ] Add `syncFailed` state to Zustand store
8. [ ] Intercept `X-Sync-Status` header in API layer, update store
9. [ ] Create `SyncStatusIndicator` component — yellow warning button, fixed position, non-blocking
10. [ ] Wire button click to `POST /api/retry-sync`, clear indicator on success
11. [ ] Frontend tests

## Acceptance Criteria

- [ ] Failed R2 syncs set the `sync_failed` flag and return `X-Sync-Status: failed` header
- [ ] Every subsequent write request retries sync automatically (via existing middleware)
- [ ] `POST /api/retry-sync` endpoint allows manual retry
- [ ] Frontend shows a visible, non-blocking yellow indicator when out of sync
- [ ] Indicator is a clickable button that triggers manual retry
- [ ] Indicator disappears when sync succeeds (from either auto-retry or manual)
- [ ] No background processes — all sync attempts are in the request/response cycle
- [ ] No performance regression on happy path (no extra R2 calls when sync is healthy)
- [ ] Backend and frontend tests pass
