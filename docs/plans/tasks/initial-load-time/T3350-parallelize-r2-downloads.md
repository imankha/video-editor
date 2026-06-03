# T3350: Parallelize R2 Downloads in auth/init

**Epic:** [Initial Load Time](EPIC.md)
**Priority:** P0
**Complexity:** 3
**Impact:** 8
**Status:** TODO

## Problem

`POST /api/auth/init` calls `user_session_init()` which downloads `user.sqlite` then `profile.sqlite` from R2 sequentially. These two files are independent -- neither depends on the other to start downloading. Sequential download: ~500-900ms + ~500-900ms = ~1-1.8s. Parallel: ~max(500-900ms) = ~500-900ms.

## Evidence

- session_init.py:66 -- `ensure_user_database(user_id)` downloads user.sqlite
- session_init.py:100-101 -- `ensure_database()` downloads profile.sqlite
- database.py:521 -- `sync_database_from_r2_if_newer()` is the blocking R2 call
- auth/init server wait: 1773ms total

## Implementation

### Identify the dependency chain

Before parallelizing, map what depends on what:

1. `ensure_user_database(user_id)` -- downloads user.sqlite from R2. Needed to read profiles list.
2. Profile selection logic -- reads profiles from user.sqlite to pick active profile. Needs user.sqlite.
3. `ensure_database(user_id, profile_id)` -- downloads profile.sqlite from R2. Needs profile_id.

The dependency is: user.sqlite download -> read profiles -> profile.sqlite download. These are NOT independent in the current code because profile_id comes from user.sqlite.

### Optimization approach

The real win is **speculatively starting the profile.sqlite download**. The active profile_id is stored in user.sqlite, but we can also read it from `_init_cache` (if available from a prior session on this machine) or from a cookie/header.

**Option A (simpler):** If the frontend sends X-Profile-ID header on auth/init, use that to start profile.sqlite download in parallel with user.sqlite download. The frontend already has the profile_id from the previous session (stored in sessionInit.js `_currentProfileId` or localStorage).

**Option B (if no cached profile_id):** Download user.sqlite first, then immediately start profile.sqlite download. At minimum, ensure neither download blocks the event loop -- use `asyncio.gather` with `asyncio.to_thread` wrappers if the current code is synchronous.

### Implementation steps

1. Accept optional `profile_id` in the auth/init request body (frontend sends last-known profile_id)
2. If `profile_id` is provided, fire both R2 downloads in parallel using `concurrent.futures.ThreadPoolExecutor`
3. After both complete, validate that the provided profile_id still exists in user.sqlite's profiles table
4. If profile_id is invalid or not provided, fall back to current sequential behavior (download user.sqlite, read profiles, download profile.sqlite)

## Files

| File | Change |
|------|--------|
| `src/backend/app/services/session_init.py` | Parallelize R2 downloads when profile_id is known |
| `src/backend/app/routers/auth.py` | Accept optional profile_id in auth/init body |
| `src/frontend/src/services/sessionInit.js` | Send last-known profile_id with auth/init request |

## Acceptance Criteria

- [ ] When profile_id is provided, both R2 downloads fire in parallel
- [ ] auth/init server wait drops from ~1.8s to ~1.0s (measured via HAR)
- [ ] Invalid/stale profile_id falls back gracefully to sequential behavior
- [ ] First-time users (no cached profile_id) still work correctly
