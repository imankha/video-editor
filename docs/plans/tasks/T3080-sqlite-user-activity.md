# T3080: Sync User Activity to SQLite

## Summary

Dual-write user activity data (session counts, event counts, last_active_at) to per-user SQLite alongside Postgres, so per-user activity is available locally without cross-user Postgres queries.

## Motivation

All user activity data currently lives exclusively in Postgres (`user_milestones` + `user_flow_events`). This means:

1. **No data locality.** Per-user activity (session count, last active, event counts) requires a Postgres query even though the user's SQLite DB is already loaded and synced via R2.
2. **Offline/fast reads.** With activity in user.sqlite, the frontend `/me` endpoint or any per-user dashboard can read session_count, event counts, and last_active_at from the already-open SQLite connection -- zero Postgres round-trips.
3. **Self-contained user data.** user.sqlite already holds credits, profiles, quests, and settings. Activity data completes the picture -- a user's SQLite file becomes the single source of per-user state.
4. **R2 portability.** Since user.sqlite syncs to R2, activity data travels with the user across machines (session pinning, failover, machine restarts) without Postgres dependency.

Postgres remains the source of truth for **cross-user analytics** (cohort queries, daily_counters, funnel analysis, admin dashboards). SQLite is for **per-user reads**.

## Current State

`analytics.py` writes exclusively to Postgres:
- `record_milestone(user_id, event)` -- upserts `user_flow_events` (event + count) and updates `user_milestones` (last_active_at, last_export_at)
- `update_session(user_id, is_pwa)` -- increments session_count/pwa_session_count on `user_milestones` if >30 min since last_active_at
- `create_user_milestones(user_id, ...)` -- inserts the initial `user_milestones` row on signup

No user activity data exists in user.sqlite today. The `_USER_DB_SCHEMA` in `user_db.py` has credits, credit_transactions, credit_reservations, stripe_customers, completed_quests, profiles, and user_settings.

## Design

### What Data Goes Where

| Data | Postgres | SQLite | Why |
|------|----------|--------|-----|
| Cohort dimensions (origin_type, install_day, signup_method) | Yes | No | Cross-user analytics only; immutable after signup |
| Journey milestones (first_X_at timestamps) | Yes | No | Funnel analysis requires cross-user queries |
| Lifetime event counts (per event) | Yes | **Yes** | Postgres for admin dashboards; SQLite for per-user activity display |
| Session count / PWA session count | Yes | **Yes** | Same rationale |
| last_active_at / last_export_at | Yes | **Yes** | SQLite enables fast per-user "last seen" without Postgres |
| daily_counters | Yes | No | Global aggregate -- no per-user value |

### SQLite Schema Addition

Add a `user_activity` table to `_USER_DB_SCHEMA` in `user_db.py`:

```sql
CREATE TABLE IF NOT EXISTS user_activity (
    user_id TEXT PRIMARY KEY,
    session_count INTEGER NOT NULL DEFAULT 0,
    pwa_session_count INTEGER NOT NULL DEFAULT 0,
    last_active_at TEXT,           -- ISO8601 datetime
    last_export_at TEXT,           -- ISO8601 datetime
    updated_at TEXT DEFAULT (datetime('now'))
);
```

Add a `user_activity_events` table for per-event counts (mirrors `user_flow_events` in Postgres):

```sql
CREATE TABLE IF NOT EXISTS user_activity_events (
    event TEXT PRIMARY KEY,        -- e.g. 'game_created', 'clip_created'
    count INTEGER NOT NULL DEFAULT 0,
    first_at TEXT,                 -- ISO8601 datetime
    updated_at TEXT DEFAULT (datetime('now'))
);
```

**Design notes:**
- `user_activity` is one row per user (same as `user_milestones` in Postgres). The `user_id` column exists for schema consistency with other tables in user.sqlite that use it as PK.
- `user_activity_events` uses `event` as PK (no user_id needed since each user.sqlite is already per-user).
- ISO8601 TEXT for timestamps (consistent with all other user.sqlite tables like `credit_transactions.created_at`).

### Dual-Write Strategy

Modify `analytics.py` functions to write to both Postgres and user.sqlite:

**`record_milestone(user_id, event)`:**
1. Existing Postgres write (unchanged)
2. After Postgres succeeds, open user.sqlite via `get_user_db_connection(user_id)`:
   - UPSERT into `user_activity_events`: increment count, set first_at on first occurrence
   - UPDATE `user_activity`: set last_active_at, and last_export_at if export event

**`update_session(user_id, is_pwa)`:**
1. Existing Postgres write (unchanged)
2. After Postgres succeeds and returns the new session_count, write to user.sqlite:
   - UPSERT `user_activity`: set session_count, pwa_session_count, last_active_at

**`create_user_milestones(user_id, ...)`:**
1. Existing Postgres write (unchanged)
2. After Postgres succeeds, initialize `user_activity` row in user.sqlite with defaults

**Error handling:**
- SQLite write failures must NOT fail the request. Wrap in try/except with warning log.
- Postgres remains the source of truth. SQLite is best-effort with backfill to catch up.
- Pattern: `try: _sync_to_user_sqlite(user_id, ...) except Exception: logger.warning(...)`

**Getting the SQLite connection:**
Use `get_user_db_connection(user_id)` from `user_db.py` -- the same pattern used by `confirm_reservation()` in user_db.py which already calls `record_milestone`. The connection context manager handles ensure_user_database, TrackedConnection (for R2 sync tracking), and cleanup.

### Migration

**Schema migration:** `v002_user_activity.py` in `src/backend/app/migrations/user_db/`
- Bump `PRAGMA user_version` from 1 to 2
- `CREATE TABLE IF NOT EXISTS user_activity (...)` 
- `CREATE TABLE IF NOT EXISTS user_activity_events (...)`
- Also add the tables to `_USER_DB_SCHEMA` (for fresh DBs)

**Backfill from Postgres:**
- Add a `backfill_user_activity(user_id)` function in `user_db.py`
- Called once per user on session init (same pattern as `backfill_completed_quests`)
- Queries Postgres `user_milestones` for session_count, pwa_session_count, last_active_at, last_export_at
- Queries Postgres `user_flow_events` for all events + counts for that user
- Writes to user.sqlite `user_activity` and `user_activity_events`
- Idempotent: only backfills if `user_activity` row doesn't exist yet (fresh or pre-migration DB)

**Register migration:** Update `src/backend/app/migrations/user_db/__init__.py` to include V002UserActivity.

## Implementation Plan

1. **`src/backend/app/services/user_db.py`**
   - Add `user_activity` and `user_activity_events` tables to `_USER_DB_SCHEMA`
   - Add `backfill_user_activity(user_id)` function
   - Add `get_user_activity(user_id)` read helper (for future per-user dashboard use)

2. **`src/backend/app/migrations/user_db/v002_user_activity.py`**
   - CREATE TABLE IF NOT EXISTS for both new tables
   - Set user_version = 2

3. **`src/backend/app/migrations/user_db/__init__.py`**
   - Register V002UserActivity in MIGRATIONS list

4. **`src/backend/app/analytics.py`**
   - Add `_sync_to_user_sqlite(user_id, event)` helper for record_milestone SQLite writes
   - Add `_sync_session_to_user_sqlite(user_id, session_count, pwa_session_count)` helper
   - Modify `record_milestone()` to call `_sync_to_user_sqlite` after Postgres write
   - Modify `update_session()` to call `_sync_session_to_user_sqlite` after Postgres write
   - Modify `create_user_milestones()` to initialize `user_activity` row in SQLite

5. **Session init backfill call site** (wherever `backfill_completed_quests` is called)
   - Add `backfill_user_activity(user_id)` call alongside existing backfills

## Risks

1. **Consistency drift.** SQLite writes are best-effort; if they fail silently (R2 sync issue, disk full, etc.), SQLite counts diverge from Postgres. Mitigated by backfill on session init -- a user returning after a failure will get re-synced.

2. **Dual-write performance.** Each `record_milestone` call now opens a user.sqlite connection in addition to the Postgres write. The SQLite write is local disk I/O (<1ms) and the connection is already pooled via `get_user_db_connection`, but it does add latency to every tracked event. Mitigated by the fact that `record_milestone` is already fire-and-forget from handlers (wrapped in try/except).

3. **R2 sync amplification.** Every SQLite write triggers the TrackedConnection dirty flag, which means R2 sync fires after the request. This is already the case for credit operations -- activity writes will increase sync frequency slightly but user.sqlite is small (<100KB typically).

4. **Backfill Postgres dependency.** `backfill_user_activity` requires a Postgres connection at session init. If Postgres is down, backfill fails (but the session still works -- it's wrapped in try/except). Subsequent activity will still be dual-written when Postgres comes back.

5. **Migration ordering.** The v002 migration must run on all existing user.sqlite files. Since user_db migrations run on `ensure_user_database` (called on every request via `get_user_db_connection`), this happens automatically on next user access.

## Test Plan

1. **Unit test: dual write in record_milestone**
   - Call `record_milestone(user_id, "game_created")` 
   - Verify Postgres `user_flow_events` has the event
   - Verify user.sqlite `user_activity_events` has event with count=1
   - Verify user.sqlite `user_activity.last_active_at` is set

2. **Unit test: session count sync**
   - Call `update_session(user_id)` with >30 min gap
   - Verify user.sqlite `user_activity.session_count` matches Postgres

3. **Unit test: backfill from Postgres**
   - Insert test data into Postgres user_milestones + user_flow_events
   - Call `backfill_user_activity(user_id)`
   - Verify user.sqlite tables match Postgres data
   - Call again -- verify idempotent (no duplicates)

4. **Unit test: SQLite failure isolation**
   - Mock SQLite connection to raise an error
   - Verify `record_milestone` still succeeds (Postgres write completes)
   - Verify warning is logged

5. **Unit test: migration v002**
   - Create a user.sqlite with user_version=1
   - Run migration
   - Verify tables exist and user_version=2

6. **Integration test: full flow**
   - Sign up user (create_user_milestones)
   - Record several milestones
   - Update session
   - Verify user.sqlite activity tables reflect all changes
