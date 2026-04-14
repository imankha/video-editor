# T1380: Recover Orphaned Jobs Per-User at Startup

**Status:** DONE
**Impact:** 5
**Complexity:** 3
**Created:** 2026-04-13
**Updated:** 2026-04-13

## Problem

At startup, `app/main.py:284` calls `recover_orphaned_jobs()` inside the FastAPI `startup_event` lifecycle. This runs with **no request and no user context**, so any code path that reads per-user state (profile.sqlite, user.sqlite, export tables) raises:

```
WARNING - Failed to recover orphaned jobs: No user context set. All requests
must go through auth middleware which sets user context from session cookie.
```

The exception is caught and logged as a warning — so startup proceeds — but orphaned jobs are **never recovered**. If a machine dies mid-export, the job row is left in `processing` state until the user happens to refresh the relevant screen.

## Solution

`recover_orphaned_jobs` must iterate over all users known to `auth.sqlite` and run the recovery logic once per user with that user's context set:

```python
for user_id in list_all_user_ids():
    with user_context(user_id):
        await recover_orphaned_jobs_for_user(user_id)
```

This requires:
1. A `list_all_user_ids()` helper in `app/services/auth_db.py`.
2. A context-manager version of `set_current_user_id()` (or use the existing ContextVar in a `try/finally`).
3. Refactor `recover_orphaned_jobs()` to take a `user_id` parameter — no implicit ContextVar lookups.

## Context

### Relevant Files
- `src/backend/app/main.py:284` — the failing startup call
- `src/backend/app/services/export_worker.py` — `recover_orphaned_jobs` implementation
- `src/backend/app/middleware/db_sync.py` — the ContextVar-based user scoping pattern

### How it was found
T1330 backend startup logs show the warning every boot. Pre-existing issue, not caused by T1330 but surfaced by cleaner post-T1330 startup output.

## Acceptance Criteria
- [ ] Startup logs no longer contain "Failed to recover orphaned jobs"
- [ ] Orphaned jobs for all known users are reconciled at boot
- [ ] Test: seed two users with orphaned `processing` jobs → start app → both are moved to `failed` or `completed` as appropriate
