# T1290: Auth DB Restore Must Succeed

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-04-10

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

- [ ] Server crashes on startup if auth.sqlite can't be restored from R2 (when R2 enabled)
- [ ] Fly.io auto-restarts the process, giving R2 another chance
- [ ] Local dev (R2 disabled) still works with empty auth DB
- [ ] Clear error logs when restore fails
