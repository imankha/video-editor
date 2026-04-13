# T1290: Auth DB Restore Must Succeed

**Status:** AWAITING USER VERIFICATION
**Impact:** 9
**Complexity:** 4
**Created:** 2026-04-10
**Branch:** `feature/T1290-auth-db-restore-must-succeed`

## Problem

On Fly.io restart, if `sync_auth_db_from_r2()` fails (network timeout, R2 unreachable), `init_auth_db()` silently creates a fresh empty database. All existing sessions become invalid. Users get new guest accounts and their old data is orphaned.

This is the most likely cause of sarkarati@gmail.com losing their email record — a deploy wiped the auth DB.

## Solution

Make auth.sqlite restore **mandatory** on startup when R2 is enabled. If restore fails, retry with backoff. If still failing after retries, fail startup (crash the process) rather than running with an empty auth DB.

## Context

### Relevant Files
- `src/backend/app/main.py` — startup sequence (~lines 270-274)
- `src/backend/app/services/auth_db.py` — `sync_auth_db_from_r2()`, `init_auth_db()`
- `src/backend/app/utils/retry.py` — existing retry infrastructure

### Related Tasks
- Part of Auth Integrity epic
- Related: T1320 (session recovery)

## Implementation

### Steps
1. [ ] In `main.py` startup, wrap `sync_auth_db_from_r2()` with retries (3 attempts, exponential backoff)
2. [ ] If all retries fail and R2 is enabled, raise fatal error (don't proceed to `init_auth_db()`)
3. [ ] Add logging for each retry attempt
4. [ ] Only fall through to `init_auth_db()` (create empty) if R2 is disabled (local dev)

## Acceptance Criteria

- [x] Server crashes on startup if auth.sqlite can't be restored from R2 (when R2 enabled)
- [x] Fly.io auto-restarts the process, giving R2 another chance (behaviour inherited from Fly, not re-tested here)
- [x] Local dev (R2 disabled) still works with empty auth DB
- [x] Clear error logs when restore fails

## Result

### Before (failing tests on the task branch, pre-fix)

```
6 failed, 1 passed in 7.73s
- AttributeError: module 'app.services.auth_db' has no attribute '_r2_enabled'
- AttributeError: module 'app.services.auth_db' has no attribute 'restore_auth_db_or_fail'
- test_sync_auth_db_from_r2_raises_on_transient_error: DID NOT RAISE (current
  behaviour silently returns False and hides the error)
```
The one that passed is the 404 case — already handled in the existing code.

### After (fix applied)

```
tests/test_auth_db_restore.py  7 passed in 14.36s
```

### Full backend suite after fix

```
15 failed, 671 passed, 6 skipped, 6 errors in 103.48s
```

All 15 failures + 6 errors are pre-existing and unrelated to this task
(see T1270 orchestrator notes): `test_admin`, `test_double_grant` (asyncio
event-loop, no auth DB touch), `test_guest_migration`, `test_migration_recovery`,
`test_sync_retry` (missing `retry_pending_sync`), `test_version_conflict`
(profile-context fixture), `test_annotations_aggregates` (404 on
`/api/games/{id}` fixture). **Zero new failures attributable to T1290.**

### Files changed

- `src/backend/app/services/auth_db.py` — `sync_auth_db_from_r2` now raises
  on transient/non-404 errors; new `restore_auth_db_or_fail` wraps with a
  3-attempt exponential-backoff retry and raises RuntimeError on exhaustion.
- `src/backend/app/main.py` — startup calls `restore_auth_db_or_fail()`
  instead of the old `sync_…; init_…` pair.
- `src/backend/tests/test_auth_db_restore.py` — new test file (7 tests).

### Commits

- `d4ce555` — failing tests
- `38c3b2e` — fix
- (docs commit to follow)

## Manual Verification (staging / prod)

Automated tests cover the retry + fatal-fail logic. The actual R2 round-trip
failure mode must be verified against the real deploy pipeline:

1. **Happy path (must stay green):** Deploy staging on this branch with the
   real `R2_*` env vars. Tail Fly logs during startup. Expect a single
   `[AuthDB] Restored from R2: staging/auth/auth.sqlite` line followed by
   `[AuthDB] Tables initialized` and `[Startup] Central auth DB initialized`.
   App should come up normally; signing in as an existing user should still
   find their email record.

2. **Fatal-fail path (the new behaviour):** Temporarily override
   `R2_SECRET_ACCESS_KEY` on a staging machine to a bogus value
   (`fly secrets set R2_SECRET_ACCESS_KEY=broken -a <staging-app>` on a
   scratch staging app — do NOT do this on the main staging app used for
   other verification). Expect:
     - 3 warnings: `[AuthDB] Restore attempt N/3 failed: ...`
     - 1 error:    `[AuthDB] Restore attempt 3/3 failed: ... giving up`
     - Process exits with `RuntimeError: auth DB restore from R2 failed
       after 3 attempts; refusing to start with an empty auth DB.`
     - Fly.io auto-restarts the machine; the loop continues until either
       the secret is fixed or Fly backs the machine off.

3. **Restore the good secret** and confirm the app boots normally again.

4. **Local dev sanity:** With `R2_ENABLED=false`, `uvicorn app.main:app`
   should log `[AuthDB] R2 disabled — skipping restore, using local DB` and
   boot normally with whatever is in `user_data/auth.sqlite`.
