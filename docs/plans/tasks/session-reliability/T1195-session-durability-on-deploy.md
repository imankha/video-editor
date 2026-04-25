# T1195: Session Durability on Deploy

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-04-24
**Updated:** 2026-04-24

## Problem

Google OAuth (and OTP login) creates a user record and session in auth.sqlite, but auth paths are in `SKIP_SYNC_PATHS` so the session is never synced to R2. When the Fly.io machine restarts (deploy, crash, scale event), auth.sqlite is restored from R2 and the session is gone. The user is silently logged out with no explanation.

### Real-world case

nick.n.parsons@gmail.com signed up via Google on Apr 24. We deployed production the same day, restarting the machine. His session was lost:
- `verified_at` is set (OAuth succeeded)
- `last_seen_at` is None (never synced)
- No session in the sessions table (lost on restart)
- No profile directory in R2 (profile init never ran)

From Nick's perspective: he signed in, possibly saw the app briefly, then everything broke or he was kicked back to login.

## Solution

Sync auth.sqlite to R2 immediately after session creation in the OAuth and OTP login handlers. This ensures sessions survive machine restarts.

### Changes

1. **OAuth callback** (`src/backend/app/routers/auth.py`): After `_issue_session_cookie()`, call `sync_auth_db_to_r2()`. The user record sync already happens in `_find_or_create_user()`, but the session created afterward is not synced.

2. **OTP verify** (`src/backend/app/routers/auth.py`): Same pattern — sync after session creation.

3. **Consider**: Whether `update_last_seen()` in `/api/auth/me` should also trigger a sync, or if that's acceptable to leave lazy (it's less critical than session loss).

## Context

### Relevant Files
- `src/backend/app/routers/auth.py` — OAuth and OTP handlers, `_issue_session_cookie()`
- `src/backend/app/services/auth_db.py` — `sync_auth_db_to_r2()`, `create_session()`
- `src/backend/app/middleware/db_sync.py` — `SKIP_SYNC_PATHS` definition

### Related Tasks
- Part of: Session Reliability epic
- Followed by: T1190 (Session & Machine Pinning) — solves the broader machine affinity problem
- Related: T1270 (Cookie Path + SameSite Fix) — prior session durability fix
- Related: T1290 (Auth DB Restore Must Succeed) — ensures restore works on startup

### Technical Notes
- `sync_auth_db_to_r2()` uploads the entire auth.sqlite file. It's small (~70KB) so this is fast.
- Auth paths are in `SKIP_SYNC_PATHS` to avoid syncing profile DBs on every auth call. This fix targets only the login endpoints, not all auth paths.
- This is intentionally a narrow fix. The broader session affinity problem (requests hitting wrong machine) is T1190's scope.

## Implementation

### Steps
1. [ ] In OAuth callback, add `sync_auth_db_to_r2()` after `_issue_session_cookie()`
2. [ ] In OTP verify handler, add `sync_auth_db_to_r2()` after session creation
3. [ ] Add backend test: simulate OAuth login → verify auth.sqlite synced to R2 with session
4. [ ] Add backend test: simulate machine restart (re-download auth.sqlite from R2) → verify session still valid
5. [ ] Manual test: sign in on production, restart Fly machine, verify session survives

## Acceptance Criteria

- [ ] OAuth login syncs auth.sqlite to R2 (session included)
- [ ] OTP login syncs auth.sqlite to R2 (session included)
- [ ] Session survives Fly machine restart
- [ ] No regression: auth endpoints remain fast (sync adds <500ms)
