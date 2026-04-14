# T1390: Process Modal Queue Per-User at Startup

**Status:** DONE
**Impact:** 5
**Complexity:** 3
**Created:** 2026-04-13
**Updated:** 2026-04-13

## Problem

At startup, `app/main.py:291-298` calls `process_modal_queue()` from inside the FastAPI `startup_event`. Same shape of bug as T1380 — no request, no user context, so any per-user SQLite access raises:

```
WARNING - Failed to process modal queue: No user context set. All requests
must go through auth middleware which sets user context from session cookie.
```

The queue is effectively never drained at boot. Queued Modal jobs only advance when a user makes a subsequent request that happens to trigger queue processing.

## Solution

Mirror the fix from T1380: iterate over all users and process each user's queue under that user's context.

```python
for user_id in list_all_user_ids():
    with user_context(user_id):
        await process_modal_queue_for_user(user_id)
```

Alternatively, restructure `process_modal_queue` to query *all* queued jobs globally (if the data model allows) and resolve the user per-job inside the loop.

## Context

### Relevant Files
- `src/backend/app/main.py:291` — the failing startup call
- `src/backend/app/services/modal_queue.py` — `process_modal_queue` implementation

### Related Tasks
- T1380 — same fix pattern applied to `recover_orphaned_jobs`; share the `list_all_user_ids()` + `user_context()` helpers

### How it was found
T1330 backend startup logs. Pre-existing issue surfaced by the cleaner post-T1330 startup output.

## Acceptance Criteria
- [ ] Startup logs no longer contain "Failed to process modal queue"
- [ ] Queued Modal jobs for all users are dispatched at boot
- [ ] Test: seed queued jobs for two users → start app → both users' queues drain
