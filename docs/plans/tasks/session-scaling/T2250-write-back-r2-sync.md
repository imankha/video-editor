# T2250: Write-Back R2 Sync

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-05-01

## Problem

Every user gesture (crop keyframe drag, segment edit, tag change) blocks the HTTP response for 50-200ms while the entire SQLite file uploads to R2. With session pinning (T1190), the local SQLite is the authoritative copy during the session — R2 is just a durability backup. We're paying write-through latency for a guarantee we don't need on every gesture.

At 100K DAU, per-gesture sync also costs ~$130/month in R2 PUT operations. Write-back reduces this to ~$36/month.

## Solution

Switch from write-through (sync on every write) to write-back (sync periodically + on explicit triggers). Writes respond in ~0.1ms instead of ~200ms.

### Sync triggers

| Trigger | Behavior | Blocks response? |
|---------|----------|-----------------|
| **Export start** | Explicit sync before GPU job launches | Yes (already does this) |
| **Sign-out** | Final sync, block until confirmed. If sync fails, warn user: "Recent edits couldn't be saved. Stay signed in?" Don't clear session cookie until sync succeeds. | Yes |
| **Session invalidation** | Old machine syncs before returning 401. If sync fails, return 503 "try again" and keep session alive temporarily. Only return 401 after sync succeeds or N retries exhausted. | Yes |
| **Periodic timer** | Background task syncs dirty users every ~3 minutes | No |
| **Machine restart** | Check `.sync_pending` marker on boot, retry sync | No (startup path) |

### Dirty tracking

```python
# In-memory, per-user
_dirty_users: Dict[str, float] = {}  # user_id -> timestamp of first unsynced write

def mark_user_dirty(user_id: str):
    """Called by middleware when TrackedCursor detects writes."""
    if user_id not in _dirty_users:
        _dirty_users[user_id] = time.time()
        mark_sync_pending(user_id)  # existing crash-recovery marker

def clear_user_dirty(user_id: str):
    """Called after successful sync."""
    _dirty_users.pop(user_id, None)
    clear_sync_pending(user_id)
```

### Background periodic sync

```python
async def periodic_sync_task():
    """Started in main.py on app startup."""
    while True:
        await asyncio.sleep(60)  # check every minute
        now = time.time()
        for user_id, dirty_since in list(_dirty_users.items()):
            if now - dirty_since >= SYNC_INTERVAL_SECONDS:  # 180s
                profile_id = get_cached_profile_id(user_id)
                ok = await asyncio.to_thread(sync_db_to_r2_explicit, user_id, profile_id)
                if ok:
                    # Also sync user.sqlite if it had writes
                    await asyncio.to_thread(sync_user_db_to_r2_explicit, user_id)
                    clear_user_dirty(user_id)
                # On failure: leave dirty, retry next cycle
```

## Changes

### Middleware (`db_sync.py`)

**`_sync_aware_flow` (lines 444-684):**
- Remove the blocking R2 sync after handler execution
- Replace with `mark_user_dirty(user_id)` when writes detected
- Keep TrackedCursor, write detection, request context — unchanged
- Keep `X-Sync-Status` header — repurpose to indicate "has unsynced local writes"
- Per-user write lock: still needed for SQLite serialization, but hold time drops from 50-200ms to ~0.1ms

### Sign-out (`auth.py`)

**`logout()` endpoint (lines 549-573):**
- Before clearing session: call `sync_db_to_r2_explicit()` + `sync_user_db_to_r2_explicit()` synchronously
- If sync fails: return error response suggesting user stay signed in
- If sync succeeds: clear `_dirty_users`, then proceed with existing VACUUM + cookie clearing
- VACUUM still runs as background task after sync

### Session invalidation flow

**When `validate_session()` returns invalid (middleware):**
- Check if user_id is in `_dirty_users`
- If dirty: trigger sync-before-401
  - Success: clear dirty flag, return 401 `{ reason: "signed_in_elsewhere" }`
  - Failure: return 503 `{ reason: "sync_pending", retry_after: 5 }` — keep session alive for retry
  - After N failures (3): accept loss, return 401, log data loss event for T2260

### App startup (`main.py`)

- Start `periodic_sync_task()` as background asyncio task
- On shutdown signal: sync all dirty users before exiting (graceful drain)

### Export worker (`export_worker.py`)

- No change — already calls `sync_db_to_r2_explicit()` explicitly after export completes

## Context

### Depends on
- **T1190** (Session & Machine Pinning) — write-back is only safe when one machine owns each user's data

### Enables
- **T2260** (Data Loss Detection & Recovery) — the ~3 min data loss window this introduces needs detection + UX

### What doesn't change
- TrackedCursor / TrackedConnection (write detection stays)
- `ensure_database()` cold-start flow (still downloads from R2 on first access)
- Export worker explicit sync
- `.sync_pending` marker file (repurposed for dirty tracking)
- Per-user write lock (still needed, just held for less time)

### Risks
- Browser crash with dirty state: up to 3 minutes of edits lost. Mitigated by periodic sync + T2260 detection.
- Sign-out sync failure: user warned, session not cleared. User can retry or stay signed in.
- Graceful shutdown timing: if Fly.io sends SIGTERM, we need enough time to sync all dirty users before process exits.

## Implementation

### Steps
1. [ ] Add `_dirty_users` tracking module with mark/clear/list functions
2. [ ] Modify `_sync_aware_flow` to call `mark_user_dirty()` instead of blocking R2 sync
3. [ ] Add `periodic_sync_task()` background task, start in `main.py` lifespan
4. [ ] Add graceful shutdown: sync all dirty users on SIGTERM/lifespan shutdown
5. [ ] Modify `logout()` to sync before clearing session; handle failure with warning response
6. [ ] Add sync-before-401 logic in middleware for invalidated sessions
7. [ ] Add 503 retry logic when sync-before-401 fails
8. [ ] Update `X-Sync-Status` header semantics (dirty vs synced vs failed)
9. [ ] Add `SYNC_INTERVAL_SECONDS` config (default 180, configurable per environment)
10. [ ] Test: rapid gestures no longer block on R2
11. [ ] Test: sign-out syncs before clearing session
12. [ ] Test: device handoff syncs old machine's state before 401
13. [ ] Test: periodic sync fires after interval for dirty users
14. [ ] Test: machine restart retries sync for pending markers

## Acceptance Criteria

- [ ] Write responses return in <5ms (no R2 blocking)
- [ ] R2 sync happens within SYNC_INTERVAL_SECONDS of first unsynced write
- [ ] Sign-out blocks until sync succeeds or warns user on failure
- [ ] Session invalidation triggers sync-before-401 on old machine
- [ ] Failed sync-before-401 returns 503 with retry, not silent data loss
- [ ] Graceful shutdown syncs all dirty users before process exit
- [ ] Export sync unchanged (still explicit before GPU job)
- [ ] `.sync_pending` marker set on first dirty write, cleared on sync
