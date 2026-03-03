# T127: R2 Database Restore on Startup

**Status:** TODO
**Impact:** 8
**Complexity:** 4

## Problem

When the Fly.io machine stops (not suspends) and restarts, or when a new deploy happens, the local SQLite database on ephemeral storage is wiped. The app syncs SQLite to R2 on writes, but does not restore from R2 on cold start. This causes uploaded games, clips, and projects to disappear after a machine restart.

A user uploaded a game on staging, the machine stopped, and on restart the game was gone because the local database started empty.

## Solution

On startup, before the app begins serving requests, check if the local SQLite database is missing or empty and restore the latest version from R2. This is the complement to the existing write-time R2 sync.

## Context

### Current State
- SQLite is stored on ephemeral filesystem (not a Fly Volume)
- On every write, the database is synced to R2 (`DatabaseSyncMiddleware`)
- On cold start, the app creates a fresh empty database
- User data uploaded before a restart is lost from the local perspective

### Target State
- On startup, check R2 for existing user databases
- Download and restore them before accepting requests
- App boots with all previously synced data intact

### Relevant Files
- `src/backend/app/main.py` — Startup event handler
- `src/backend/app/middleware/db_sync.py` — Existing sync middleware (reference for R2 paths)
- `src/backend/app/services/r2_storage.py` — R2 download/upload helpers
- `src/backend/app/database.py` — Database initialization

### Related Tasks
- Depends on: T100 (Fly.io backend must be deployed)
- Related: T126 (suspend mode reduces frequency of cold starts, but doesn't eliminate them)

### Technical Notes
- R2 key pattern for user databases: `{env}/users/{user_id}/{profile_id}/database.db` (verify from sync middleware)
- Need to handle: first-ever startup (no R2 data exists), partial restore, concurrent access during restore
- Should block request handling until restore is complete (use FastAPI lifespan)
- Consider: restore all known users on startup vs lazy restore on first request per user
  - Lazy restore is simpler and scales better (only restore when a user actually makes a request)

## Implementation

### Steps
1. [ ] Audit current R2 sync paths to understand database key structure
2. [ ] Add startup restore logic: check R2 for user database, download if exists
3. [ ] Decide: eager (all users on boot) vs lazy (per-user on first request)
4. [ ] Implement chosen strategy with proper error handling
5. [ ] Test: upload game → wait for machine stop → verify game exists after restart
6. [ ] Test: fresh deploy with no local data → verify R2 data is restored

### Logging Requirements
- Log on startup: `[Startup] Checking R2 for existing databases...`
- Log restore per user: `[Startup] Restored database for user {user_id} from R2 ({size} bytes, last modified {timestamp})`
- Log skip: `[Startup] No R2 database found for user {user_id}, starting fresh`
- Log restore timing: `[Startup] Database restore complete in {n}s ({n} users restored)`
- Log errors: `[Startup] Failed to restore database for user {user_id}: {error}` (non-fatal, continue serving)
- Log on first request for lazy restore: `[Restore] Lazy-restoring database for user {user_id} from R2`

## Acceptance Criteria

- [ ] After machine restart, previously uploaded data is accessible
- [ ] Fresh deploys restore data from R2 automatically
- [ ] No requests served with stale/empty database (restore completes before serving)
- [ ] First-time users (no R2 data) still work correctly
- [ ] Restore errors are logged clearly, don't crash the app
- [ ] All restore operations are logged with timing and user context
