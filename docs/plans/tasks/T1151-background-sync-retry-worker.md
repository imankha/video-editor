# T1151: Background Sync Retry Worker

**Status:** NOT RECOMMENDED
**Impact:** 2 (narrow — only idle-after-failure sessions benefit)
**Complexity:** 6 (concurrency with active requests)
**Created:** 2026-04-13
**Updated:** 2026-04-13

## Decision: Not Recommended (2026-04-13)

The failure mode this solves — a user's sync fails AND they go idle before
the next request — is narrow. Active users are already covered by T1150's
request-driven retry. The concurrency surface this introduces is wide:

- **SQLite writer lock**: worker reading the DB file concurrent with a
  request's write can upload a torn/inconsistent snapshot. Needs WAL
  checkpoint coordination or snapshot-under-lock.
- **Version races**: worker and an incoming request can both observe the
  marker and both kick off an upload. The second one 409s on R2 version
  check and leaves the marker dirty for no reason. Needs a per-user lock.
- **R2 version churn**: aggressive polling increments version numbers
  without user-visible benefit and makes conflict debugging harder.

For the idle-user data-loss scenario specifically, the better mitigations
are upstream: fix partial-failure semantics (T1154), or evaluate whether
critical writes should block on R2 in the first place (T1153). Revisit
this task only if logs show meaningful data loss from idle-after-failure
in practice.

## Problem

The `.sync_pending` marker is only retried when the same user makes another request. If a user writes, R2 fails, and they close the tab, the marker sits on local disk until they return. On Fly.io with machine recycling or volume loss, that data can be lost before any retry fires.

Request-driven retry is fine for active users but provides zero recovery for idle-after-failure sessions — exactly the case where data loss is most likely (user finishes their edit, closes laptop, R2 was blipping during the final save).

## Solution

Add a background worker that scans `USER_DATA_BASE/*/​.sync_pending` on an interval and invokes `retry_pending_sync(user_id)` for each. Independent of request traffic.

Sketch:
```python
# app/background/sync_retry_worker.py
async def sync_retry_loop():
    while True:
        await asyncio.sleep(RETRY_INTERVAL_SECONDS)  # e.g. 60s
        for marker in USER_DATA_BASE.glob("*/.sync_pending"):
            user_id = marker.parent.name
            if age(marker) < MIN_AGE_SECONDS:
                continue  # let request-driven retry try first
            try:
                if retry_pending_sync(user_id):
                    clear_sync_pending(user_id)
                    set_sync_failed(user_id, False)
            except Exception as e:
                logger.warning(f"[SYNC WORKER] retry failed for {user_id}: {e}")
```

Start the loop in `app.main` startup; cancel on shutdown.

## Context

### Relevant Files
- `src/backend/app/main.py` — startup/shutdown hooks
- `src/backend/app/middleware/db_sync.py` — `retry_pending_sync` helper (T1150)
- `src/backend/app/database.py` — `USER_DATA_BASE`, `clear_sync_pending`, `has_sync_pending`
- New: `src/backend/app/background/sync_retry_worker.py`

### Related Tasks
- Depends on: T1150 (retry_pending_sync must exist and work)
- Related: T1152 (persistent sync-failed state — worker should update it too)

### Technical Notes
- `profile_id` dependency: `retry_pending_sync` currently reads `get_current_profile_id()` from a ContextVar. Worker runs outside request scope — needs to discover profile_id(s) per user (scan `profiles/*/profile.sqlite`). Refactor `retry_pending_sync` to accept explicit `profile_id`, or loop over profile dirs.
- Exponential backoff: don't hammer R2 during an outage. Track per-user retry attempt count; back off to 5min/15min/1hr.
- Multi-machine safety: on Fly.io with multiple machines, the worker on machine A shouldn't retry machine B's pending marker (different local disks). This is naturally correct because markers live on the local volume — each machine only sees its own.
- Observability: log retry attempts/successes/failures with user_id; consider a `/api/admin/sync-status` endpoint.

## Acceptance Criteria

- [ ] Worker runs on backend startup, cancels cleanly on shutdown
- [ ] Picks up `.sync_pending` markers without a request trigger
- [ ] Successful retry clears marker and `_sync_failed` flag
- [ ] Failed retry leaves marker in place for next interval
- [ ] Exponential backoff on repeated failures (doesn't hammer R2)
- [ ] Test: write marker, mock R2 success, worker tick clears it
- [ ] Test: write marker, mock R2 failure, worker tick leaves it
