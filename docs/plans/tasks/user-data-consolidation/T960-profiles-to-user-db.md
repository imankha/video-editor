# T960: Profiles to User DB

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-04-03
**Updated:** 2026-04-03

## Problem

Profile data (name, color, default, selected) is stored as JSON files in R2 (`profiles.json`, `selected-profile.json`). This has no transactional guarantees, requires extra network round-trips on session init, and is awkward to query or migrate.

### Expected Behavior
Profile metadata lives in `user.sqlite` with proper schema, constraints, and transactional writes.

### Actual Behavior
Profile CRUD reads/writes JSON blobs to R2 via `storage.py` (lines ~1231-1391). Session init downloads `profiles.json` and `selected-profile.json` from R2 on every cold start.

## Solution

1. Add `profiles` table to `user.sqlite` schema:
   ```sql
   CREATE TABLE profiles (
     id TEXT PRIMARY KEY,           -- 8-char GUID (existing format)
     name TEXT NOT NULL,
     color TEXT NOT NULL,
     is_default INTEGER DEFAULT 0,
     created_at TEXT DEFAULT (datetime('now'))
   );
   CREATE TABLE user_settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );
   -- selected_profile stored as: INSERT INTO user_settings (key, value) VALUES ('selected_profile', '{id}')
   ```

2. Migrate R2 JSON → user.sqlite on session init (one-time, idempotent)
3. Update profile CRUD endpoints to read/write user.sqlite instead of R2 JSON
4. Update session init to read profiles from user.sqlite
5. Keep R2 JSON writes as backup sync (deprecate later)

## Context

### Relevant Files
- `src/backend/app/routers/profiles.py` — profile API endpoints
- `src/backend/app/storage.py` (lines ~1231-1391) — R2 profile JSON read/write
- `src/backend/app/session_init.py` — user_session_init reads profiles from R2
- `src/backend/app/services/user_db.py` — user.sqlite schema and operations
- `src/frontend/src/stores/profileStore.js` — frontend profile state (no changes expected)

### Related Tasks
- T920: User-Level DB (created user.sqlite — this task extends it)
- T970: User-Scoped Quest Achievements (sibling task)
