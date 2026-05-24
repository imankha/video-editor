# T3080 Test & Fix: Sync User Activity to SQLite

## Task

Read this handoff document and help me test, debug, and fix T3080: dual-write user activity data to per-user SQLite alongside Postgres.

## What Was Built

Every time a user action is recorded in Postgres (session start, milestone event like game_created/export_completed/share_completed, or signup), the same data is now also written to the user's per-user `user.sqlite` file. On session init, a backfill function catches up any SQLite data that's behind Postgres. SQLite failures never break the request -- they're caught and logged as warnings.

**Branch:** `feature/T3080-sqlite-user-activity`
**Status:** TESTING (8 automated tests pass)

---

## Architecture

```
User Action (browser)
        |
        v
  FastAPI endpoint
        |
        v
  analytics.py  ---------> Postgres (source of truth)
        |                     user_milestones (session_count, last_active_at)
        |                     user_flow_events (event, count, first_at)
        |
        +-- try/except ----> user.sqlite (best-effort copy)
                               user_activity (session_count, last_active_at)
                               user_activity_events (event, count)
                               |
                               v
                             R2 sync (automatic via TrackedConnection)

Session Init (on first request per user per server process)
        |
        v
  session_init.py step 8
        |
        v
  backfill_user_activity(user_id)
        |
        v
  Read Postgres -> Write SQLite (idempotent, skip if row exists)
```

Three write paths in `analytics.py` have dual-write:

| Function | Postgres writes | SQLite writes |
|----------|----------------|---------------|
| `create_user_milestones()` | INSERT user_milestones | INSERT OR IGNORE user_activity (defaults) |
| `record_milestone(event)` | UPSERT user_flow_events + UPDATE user_milestones | UPSERT user_activity_events + UPSERT user_activity |
| `update_session()` | UPDATE user_milestones session_count | UPSERT user_activity with session_count from Postgres RETURNING |

---

## Files Changed

### Backend
| File | Change |
|------|--------|
| `src/backend/app/services/user_db.py` | Added `user_activity` + `user_activity_events` tables to `_USER_DB_SCHEMA`. Added `backfill_user_activity()` and `get_user_activity()` functions. |
| `src/backend/app/analytics.py` | Added SQLite dual-write try/except blocks after each Postgres write in `create_user_milestones`, `record_milestone`, and `update_session`. |
| `src/backend/app/session_init.py` | Added step 8: call `backfill_user_activity(user_id)` during session init. Renumbered steps 8-10 to 9-11. |
| `src/backend/app/migrations/user_db/v002_user_activity.py` | New migration: CREATE TABLE user_activity + user_activity_events. |
| `src/backend/app/migrations/user_db/__init__.py` | Added V002UserActivity to MIGRATIONS list. |

### Tests
| File | Tests |
|------|-------|
| `src/backend/tests/test_user_activity_sync.py` | 8 tests: dual-write, increment, export sets last_export_at, session sync, backfill + idempotency, backfill no-data, SQLite failure isolation, create_milestones init |
| `src/backend/tests/test_analytics.py` | Fixed pre-existing import: `MILESTONE_EVENTS` -> `FLOW_EVENTS` |
| `src/backend/tests/test_migrations.py` | Updated user_db track assertions: 1 -> 2 migrations, latest_version 1 -> 2 |

---

## How to Test Manually

### Prerequisites

1. Backend running: `cd src/backend && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000`
   - **IMPORTANT:** Kill ALL existing python/uvicorn processes first. Zombie uvicorn processes caused stale code to be served during implementation. Use `taskkill /F /T /PID <pid>` or restart your terminal.
2. Frontend running: `cd src/frontend && npm run dev`
3. Dev Postgres must be accessible (`.env` has `DATABASE_URL`)
4. The v002 migration runs automatically for fresh user.sqlite files. For existing users, session init backfill handles it.

### Test Flow

**Test 1: Verify dual-write on milestone events**

1. Log in as any user (e.g., impersonate sarkarati from admin panel)
2. Perform an action that fires a milestone event:
   - Upload a game (`game_created`)
   - Create a clip (`clip_created`)
   - Export a clip (`export_completed` / `framing_exported`)
   - Share a game (`share_completed`)
3. Check Postgres has the event:
   ```bash
   cd src/backend && .venv\Scripts\python.exe -c "
   from dotenv import load_dotenv; load_dotenv('../../.env')
   from app.services.pg import init_pg_pool, get_pg; init_pg_pool()
   with get_pg() as c:
       cur = c.cursor()
       cur.execute('SELECT event, count FROM user_flow_events WHERE user_id = %s', ('USER_ID_HERE',))
       print(cur.fetchall())
   "
   ```
4. Check SQLite has the matching data:
   ```bash
   cd src/backend && .venv\Scripts\python.exe -c "
   from app.services.user_db import get_user_db_connection
   with get_user_db_connection('USER_ID_HERE') as c:
       print('activity:', dict(c.execute('SELECT * FROM user_activity WHERE user_id = ?', ('USER_ID_HERE',)).fetchone() or {}))
       print('events:', [dict(r) for r in c.execute('SELECT * FROM user_activity_events').fetchall()])
   "
   ```
5. Verify counts and timestamps match between Postgres and SQLite.

**Test 2: Verify session counting**

1. Log in as a user
2. Check admin panel shows session_count incrementing (only if >30 min since last_active_at)
3. Verify SQLite `user_activity.session_count` matches Postgres `user_milestones.session_count`

**Test 3: Verify backfill on session init**

1. Delete SQLite activity data for a user who has Postgres data:
   ```bash
   cd src/backend && .venv\Scripts\python.exe -c "
   from app.services.user_db import get_user_db_connection
   with get_user_db_connection('USER_ID_HERE') as c:
       c.execute('DELETE FROM user_activity')
       c.execute('DELETE FROM user_activity_events')
       c.commit()
       print('Cleared')
   "
   ```
2. Clear the session init cache:
   ```bash
   cd src/backend && .venv\Scripts\python.exe -c "
   from app.session_init import _init_cache
   _init_cache.clear()
   print('Cache cleared')
   "
   ```
   (Or restart the backend server)
3. Hit `/api/auth/me` or any authenticated endpoint to trigger session init
4. Verify SQLite now has the backfilled data from Postgres

**Test 4: Verify admin panel still works**

1. Go to the admin panel
2. Confirm ORIGIN, LAST STEP, GAMES, CLIPS, EXPORTS, SHARES, SESSIONS, LAST ACTIVE columns all show correct data
3. These columns read from Postgres (`user_milestones` + `user_flow_events`), not SQLite -- so this confirms the Postgres writes weren't broken by the dual-write changes

### Edge Cases to Test

1. **SQLite failure doesn't break the request:** If user.sqlite is locked or corrupt, the Postgres write should still succeed. Look for `[Analytics] SQLite sync failed` warnings in the backend logs -- they should appear, but the user action should complete normally.
2. **Backfill is idempotent:** Running backfill twice should not double counts. The function checks for existing `user_activity` row and skips if present.
3. **New user signup:** When a new user signs up, `create_user_milestones` should create a `user_activity` row with `session_count=0` in SQLite.
4. **Export events set last_export_at:** Events in `_EXPORT_EVENTS` (`export_completed`, `framing_exported`, `overlay_exported`) should set `last_export_at` in both Postgres and SQLite.

---

## Known Potential Issues

1. **Zombie uvicorn processes:** If the admin panel shows stale data (old schema with `profiles[]`, `games_annotated`), you have an old uvicorn process still bound to port 8000. Fix: `netstat -ano | Select-String ":8000 .*LISTEN"` to find PIDs, then `taskkill /F /T /PID <pid>` for each.

2. **Missing user_milestones rows:** If a user was created before T3010 deployed, they may not have a `user_milestones` row. `record_milestone` and `update_session` do UPDATE (not UPSERT) on `user_milestones`, so they silently skip users without rows. The v005 Postgres migration backfills these, but dev DB may need: `INSERT INTO user_milestones (user_id, origin_type, signup_method) SELECT user_id, 'organic', 'otp' FROM users ON CONFLICT DO NOTHING;`

3. **`row` variable scope in `update_session`:** The SQLite write block references `row` from the Postgres try/except. If Postgres fails, `row` is undefined and the code hits `return` before reaching the SQLite block. This is intentional -- if Postgres fails, we don't have session_count to write to SQLite.

4. **R2 sync:** The SQLite writes use `get_user_db_connection()` which returns a `TrackedConnection`. Writes are automatically flagged for R2 sync by the middleware. No extra sync code needed.

5. **Migration for existing users:** The v002 migration runs via `MigrationRunner` when `ensure_user_database()` detects `PRAGMA user_version < 2`. For fresh DBs, `ensure_user_database()` runs `_USER_DB_SCHEMA` (which includes the new tables) and sets `PRAGMA user_version` to the latest directly.

---

## Running Automated Tests

```bash
# T3080 tests only (8 tests, ~7s)
cd src/backend && .venv\Scripts\python.exe -m pytest tests/test_user_activity_sync.py -v

# Migration tests (verify v002 registered correctly)
cd src/backend && .venv\Scripts\python.exe -m pytest tests/test_migrations.py -v

# Full backend suite (redirect output -- it's large)
cd src/backend && .venv\Scripts\python.exe run_tests.py 2>&1 > /tmp/test-output.log; echo "exit: $?"
```

---

## Key Code Locations for Debugging

| What | Where |
|------|-------|
| SQLite schema (user_activity tables) | `src/backend/app/services/user_db.py` lines 88-103 |
| Backfill function | `src/backend/app/services/user_db.py` `backfill_user_activity()` (~line 795) |
| Read helper | `src/backend/app/services/user_db.py` `get_user_activity()` (~line 845) |
| Dual-write in create_user_milestones | `src/backend/app/analytics.py` lines 68-78 |
| Dual-write in record_milestone | `src/backend/app/analytics.py` lines 118-140 |
| Dual-write in update_session | `src/backend/app/analytics.py` lines 170-187 |
| Session init backfill call | `src/backend/app/session_init.py` lines 126-131 |
| v002 migration | `src/backend/app/migrations/user_db/v002_user_activity.py` |
| Admin panel users endpoint | `src/backend/app/routers/admin.py` `list_users()` line 94 |
| Frontend admin table columns | `src/frontend/src/components/admin/UserTable.jsx` lines 33-46 |

---

## Dev User IDs (for queries)

| Email | user_id |
|-------|---------|
| imankh@gmail.com | 716195f2-bc91-4fbd-a752-92a6db22725d |
| sarkarati@gmail.com | aee3e218-c01c-47a6-9d50-cd02ba02e088 |
| iman@launchitlabs.io | 129b91d1-d2a9-4ff6-af97-f5d20fd57b2a |
| e2e@test.local | a6df5dae-d2ec-4185-a796-2e9fd8dc1b71 |

---

## Acceptance Criteria

- [ ] `record_milestone` writes to both Postgres `user_flow_events` and SQLite `user_activity_events`
- [ ] `update_session` writes session_count to both Postgres `user_milestones` and SQLite `user_activity`
- [ ] `create_user_milestones` initializes a SQLite `user_activity` row with defaults
- [ ] `backfill_user_activity` copies Postgres data to SQLite and is idempotent (calling twice doesn't double counts)
- [ ] SQLite failure does NOT break the Postgres write or the HTTP request
- [ ] Admin panel shows correct ORIGIN, SESSIONS, LAST ACTIVE, GAMES, CLIPS, EXPORTS, SHARES data
- [ ] Export events (`export_completed`, `framing_exported`, `overlay_exported`) set `last_export_at` in SQLite
- [ ] All 8 automated tests in `test_user_activity_sync.py` pass
