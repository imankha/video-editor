# T1195: Session Durability on Deploy

**Status:** TESTING
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

All operations are O(1). No ListObjects, no startup bulk restore, no iteration over sessions.

**Write path (login):**
1. After `_issue_session_cookie()`, write a session object to R2: `{env}/sessions/{session_id}.json`
2. Object contains: `{ user_id, email, expires_at, created_at }`
3. Single PutObject (~200 bytes) — fast, no contention with other logins

**Read path (lazy restore on cache miss):**
1. `validate_session()` checks in-memory cache → local auth.sqlite (existing behavior)
2. On **both miss**, do a single GetObject for `{env}/sessions/{session_id}.json`
3. If found and not expired: insert into local auth.sqlite, populate cache, return valid
4. If not found or expired: return invalid (existing behavior)

This means after a restart, the first request from each user pays one R2 GetObject (~50ms). Subsequent requests hit cache/local DB as before. No startup restore step needed.

**Delete path (logout):**
1. On logout, delete `{env}/sessions/{session_id}.json` from R2

**Expiry cleanup (zero code):**
- Configure an R2 object lifecycle rule on the `{env}/sessions/` prefix to auto-delete objects after the session TTL (e.g., 30 days). No cleanup code needed.

### Changes

1. **New function** `persist_session_to_r2(session_id, user_id, email, expires_at)` in `auth_db.py`
2. **New function** `restore_session_from_r2(session_id)` in `auth_db.py` — O(1) GetObject by exact key
3. **New function** `delete_session_from_r2(session_id)` in `auth_db.py`
4. **`validate_session()`**: On cache + DB miss, call `restore_session_from_r2()` before returning invalid
5. **OAuth callback** (`auth.py`): Call `persist_session_to_r2()` after `_issue_session_cookie()`
6. **OTP verify** (`auth.py`): Same — persist after session creation
7. **Logout handler**: Call `delete_session_from_r2()` alongside local session deletion
8. **R2 lifecycle rule**: Auto-delete `{env}/sessions/*` objects after session TTL

## Context

### Relevant Files
- `src/backend/app/routers/auth.py` — OAuth and OTP handlers, `_issue_session_cookie()`
- `src/backend/app/services/auth_db.py` — `sync_auth_db_to_r2()`, `create_session()`, `validate_session()`
- `src/backend/app/middleware/db_sync.py` — `SKIP_SYNC_PATHS` definition

### Related Tasks
- Part of: Session Reliability epic
- Followed by: T1190 (Session & Machine Pinning) — solves the broader machine affinity problem
- Superseded by: T1960 (Migrate Auth to Fly Postgres) — eliminates the entire class of restart-loses-state problems
- Related: T1270 (Cookie Path + SameSite Fix) — prior session durability fix
- Related: T1290 (Auth DB Restore Must Succeed) — ensures restore works on startup

### Technical Notes
- All R2 operations are O(1): PutObject on login, GetObject on cache miss, DeleteObject on logout. No ListObjects anywhere in the hot path.
- Session objects are tiny (~200 bytes JSON). PutObject adds <100ms to login. GetObject adds ~50ms on first request after restart (once per session, then cached).
- No change to `SKIP_SYNC_PATHS` — auth.sqlite full-file sync remains unchanged.
- R2 lifecycle rules handle expiry cleanup automatically — no application code needed.
- This is intentionally a narrow fix. The broader solution is T1960 (Fly Postgres for auth).

## Implementation

### Steps
1. [ ] Add `persist_session_to_r2()` — PutObject `{env}/sessions/{session_id}.json`
2. [ ] Add `restore_session_from_r2(session_id)` — GetObject by exact key, returns session data or None
3. [ ] Add `delete_session_from_r2()` — DeleteObject
4. [ ] Update `validate_session()` — on cache + DB miss, call `restore_session_from_r2()` before returning invalid
5. [ ] In OAuth callback, call `persist_session_to_r2()` after `_issue_session_cookie()`
6. [ ] In OTP verify handler, call `persist_session_to_r2()` after session creation
7. [ ] In logout handler, call `delete_session_from_r2()`
8. [ ] Configure R2 lifecycle rule to auto-delete `sessions/` objects after session TTL
9. [ ] Add backend test: login → verify session object exists in R2
10. [ ] Add backend test: simulate restart (clear local DB/cache) → first request restores from R2
11. [ ] Manual test: sign in on production, restart Fly machine, verify session survives

## Acceptance Criteria

- [ ] OAuth login persists session to R2 as individual object
- [ ] OTP login persists session to R2 as individual object
- [ ] Session survives Fly machine restart (lazy-restored on first request via O(1) GetObject)
- [ ] Logout deletes session from R2
- [ ] R2 lifecycle rule handles expired session cleanup (no application code)
- [ ] No regression: auth endpoints remain fast (PutObject <100ms on login, GetObject <50ms on first post-restart request)
- [ ] All operations are O(1) — no ListObjects, no iteration, no startup bulk restore
