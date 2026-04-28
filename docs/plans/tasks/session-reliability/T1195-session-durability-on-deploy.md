# T1195: Session Durability on Deploy

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-04-24
**Updated:** 2026-04-27

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

Persist sessions as individual R2 objects instead of syncing the entire auth.sqlite file. This scales independently of user count — each login writes one small object (~200 bytes) regardless of how many users exist.

### Why not sync auth.sqlite?

The previous approach (`sync_auth_db_to_r2()`) uploads the entire auth.sqlite file. This works today (~70KB), but auth.sqlite is the only shared database — it grows with total user count, not per-user activity. At scale:
- Upload latency grows linearly with user count
- Concurrent logins race on the upload (one overwrites the other's session)
- R2 write costs scale with total DB size, not with the change

### Design

**Write path (login):**
1. After `_issue_session_cookie()`, write a session object to R2: `{env}/sessions/{session_id}.json`
2. Object contains: `{ user_id, email, expires_at, created_at }`
3. This is a single small PutObject — fast, no contention with other logins

**Read path (restore after restart):**
1. On startup, after `restore_auth_db_or_fail()`, list `{env}/sessions/` prefix in R2
2. For each session object not already in local auth.sqlite `sessions` table, insert it
3. Delete any R2 session objects that are expired

**Delete path (logout / expiry):**
1. On logout, delete `{env}/sessions/{session_id}.json` from R2
2. `cleanup_expired_sessions()` also deletes expired R2 session objects

**Session validation (no change):**
- `validate_session()` continues to read from local auth.sqlite + in-memory cache
- R2 is only involved at login (write) and startup (restore)

### Changes

1. **New function** `persist_session_to_r2(session_id, user_id, email, expires_at)` in `auth_db.py`
2. **New function** `restore_sessions_from_r2()` in `auth_db.py` — called after `restore_auth_db_or_fail()`
3. **New function** `delete_session_from_r2(session_id)` in `auth_db.py`
4. **OAuth callback** (`auth.py`): Call `persist_session_to_r2()` after `_issue_session_cookie()`
5. **OTP verify** (`auth.py`): Same — persist after session creation
6. **Logout handler**: Call `delete_session_from_r2()` alongside local session deletion
7. **`cleanup_expired_sessions()`**: Also clean up expired R2 session objects
8. **Startup** (`main.py` or `lifespan`): Call `restore_sessions_from_r2()` after auth DB restore

## Context

### Relevant Files
- `src/backend/app/routers/auth.py` — OAuth and OTP handlers, `_issue_session_cookie()`
- `src/backend/app/services/auth_db.py` — `sync_auth_db_to_r2()`, `create_session()`
- `src/backend/app/middleware/db_sync.py` — `SKIP_SYNC_PATHS` definition
- `src/backend/app/main.py` — startup/lifespan for restore call

### Related Tasks
- Part of: Session Reliability epic
- Followed by: T1190 (Session & Machine Pinning) — solves the broader machine affinity problem
- Superseded by: T1960 (Migrate Auth to Fly Postgres) — eliminates the entire class of restart-loses-state problems
- Related: T1270 (Cookie Path + SameSite Fix) — prior session durability fix
- Related: T1290 (Auth DB Restore Must Succeed) — ensures restore works on startup

### Technical Notes
- R2 ListObjects with prefix is paginated (1000 per page). For sessions, this is fine — active sessions should be well under 1000.
- Session objects are tiny (~200 bytes JSON). PutObject latency is <100ms.
- No change to `SKIP_SYNC_PATHS` — auth.sqlite full-file sync remains unchanged.
- This is intentionally a narrow fix. The broader solution is T1960 (Fly Postgres for auth).

## Implementation

### Steps
1. [ ] Add `persist_session_to_r2()` — writes `{env}/sessions/{session_id}.json` to R2
2. [ ] Add `delete_session_from_r2()` — deletes session object from R2
3. [ ] Add `restore_sessions_from_r2()` — lists prefix, imports missing sessions, deletes expired
4. [ ] In OAuth callback, call `persist_session_to_r2()` after `_issue_session_cookie()`
5. [ ] In OTP verify handler, call `persist_session_to_r2()` after session creation
6. [ ] In logout handler, call `delete_session_from_r2()`
7. [ ] In `cleanup_expired_sessions()`, also delete expired R2 session objects
8. [ ] Call `restore_sessions_from_r2()` during startup after auth DB restore
9. [ ] Add backend test: login → verify session object exists in R2
10. [ ] Add backend test: simulate restart (restore from R2) → verify session survives
11. [ ] Manual test: sign in on production, restart Fly machine, verify session survives

## Acceptance Criteria

- [ ] OAuth login persists session to R2 as individual object
- [ ] OTP login persists session to R2 as individual object
- [ ] Session survives Fly machine restart (restored from R2 objects)
- [ ] Logout deletes session from R2
- [ ] Expired session cleanup includes R2 objects
- [ ] No regression: auth endpoints remain fast (R2 PutObject adds <100ms)
- [ ] Works independently of auth.sqlite size
