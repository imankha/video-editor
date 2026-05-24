# T3080 Kickoff: Sync User Activity to SQLite

## Task

Implement dual-write of user activity data to per-user SQLite alongside Postgres. Read `CLAUDE.md` at the repo root before starting -- it has task rules, coding principles, workflow stages, and migration system docs.

## Classification

```
**Stack Layers:** Backend
**Files Affected:** ~5 files
**LOC Estimate:** ~150 lines
**Test Scope:** Backend

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | Task file has full context |
| Architect | No | Design is specified |
| Tester | Yes | 6 test cases defined |
| Reviewer | Yes | Dual-write is a new pattern, warrants review |
| Migration | Yes | user_db v002 migration |
```

## Branch

```bash
git checkout -b feature/T3080-sqlite-user-activity
```

## Context

All user activity currently lives in Postgres only (`user_milestones` + `user_flow_events` tables). Per-user SQLite (`user.sqlite`) already stores credits, profiles, quests, and settings -- but no activity data. This task adds dual-write so activity data is also in SQLite for fast per-user reads without Postgres round-trips.

Postgres stays the source of truth for cross-user analytics. SQLite is best-effort with backfill on session init to catch up after failures.

Read the full task spec: `docs/plans/tasks/T3080-sqlite-user-activity.md`

## Files to Modify

### 1. `src/backend/app/services/user_db.py`

**Current state:** `_USER_DB_SCHEMA` (line 39) defines 7 tables: credits, credit_transactions, credit_reservations, stripe_customers, completed_quests, profiles, user_settings. The `get_user_db_connection(user_id)` context manager (line 184) returns a `TrackedConnection` that auto-flags dirty for R2 sync. The `backfill_completed_quests(user_id)` function (line 611) is the pattern to follow for backfill.

**Changes:**
- Add two tables to `_USER_DB_SCHEMA`:
  ```sql
  CREATE TABLE IF NOT EXISTS user_activity (
      user_id TEXT PRIMARY KEY,
      session_count INTEGER NOT NULL DEFAULT 0,
      pwa_session_count INTEGER NOT NULL DEFAULT 0,
      last_active_at TEXT,
      last_export_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_activity_events (
      event TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      first_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
  );
  ```
- Add `backfill_user_activity(user_id)` function:
  - Idempotent: skip if `user_activity` row already exists for this user
  - Query Postgres `user_milestones` for session_count, pwa_session_count, last_active_at, last_export_at
  - Query Postgres `user_flow_events` for all (event, count, first_at) rows for this user
  - Write to SQLite `user_activity` and `user_activity_events`
  - Wrap Postgres reads in try/except (Postgres down = skip backfill, not crash)
  - Use `get_pg()` from `app.services.pg` for Postgres access
- Add `get_user_activity(user_id)` read helper (returns dict with session_count, last_active_at, etc.) for future per-user dashboard use

### 2. `src/backend/app/migrations/user_db/v002_user_activity.py`

**Pattern to follow:** `v001_baseline.py` uses `NoOpMigration`. This one needs actual SQL:

```python
from ..base import BaseMigration

class V002UserActivity(BaseMigration):
    version = 2
    description = "Add user_activity and user_activity_events tables"

    def up(self, conn) -> None:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_activity (
                user_id TEXT PRIMARY KEY,
                session_count INTEGER NOT NULL DEFAULT 0,
                pwa_session_count INTEGER NOT NULL DEFAULT 0,
                last_active_at TEXT,
                last_export_at TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_activity_events (
                event TEXT PRIMARY KEY,
                count INTEGER NOT NULL DEFAULT 0,
                first_at TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
```

**Migration runner:** `MigrationRunner.run()` in `base.py` (line 42) calls `migration.up(conn)`, then sets `PRAGMA user_version = N`. For Postgres it INSERTs into schema_migrations; for SQLite it uses `PRAGMA user_version`. The runner calls `conn.commit()` after all pending migrations (line 55-56). Fresh DBs skip migrations entirely -- `ensure_user_database()` (user_db.py line 172) sets `PRAGMA user_version` to `RUNNER.latest_version` directly.

### 3. `src/backend/app/migrations/user_db/__init__.py`

**Current state (3 lines):**
```python
from ..base import MigrationRunner
from .v001_baseline import V001Baseline

MIGRATIONS = [V001Baseline()]
RUNNER = MigrationRunner(MIGRATIONS)
```

**Change:** Add V002UserActivity to the MIGRATIONS list.

### 4. `src/backend/app/analytics.py`

**Current state (131 lines):** Three functions write to Postgres only:
- `create_user_milestones()` (line 52): INSERTs into user_milestones + upserts daily_counters
- `record_milestone()` (line 69): UPSERTs user_flow_events, UPDATEs user_milestones (last_active_at, last_export_at), upserts daily_counters
- `update_session()` (line 106): UPDATEs user_milestones session_count with 30-min gap check, RETURNs new counts

**Changes -- add SQLite dual-write after each Postgres write:**

For `record_milestone(user_id, event)` -- after the Postgres `with get_pg()` block succeeds (line 100), add:
```python
try:
    from app.services.user_db import get_user_db_connection
    with get_user_db_connection(user_id) as conn:
        conn.execute("""
            INSERT INTO user_activity_events (event, count, first_at)
            VALUES (?, 1, datetime('now'))
            ON CONFLICT(event) DO UPDATE SET
                count = count + 1,
                updated_at = datetime('now')
        """, (event,))
        set_parts = ["last_active_at = datetime('now')", "updated_at = datetime('now')"]
        if event in _EXPORT_EVENTS:
            set_parts.append("last_export_at = datetime('now')")
        conn.execute(f"""
            INSERT INTO user_activity (user_id, last_active_at, updated_at)
            VALUES (?, datetime('now'), datetime('now'))
            ON CONFLICT(user_id) DO UPDATE SET {', '.join(set_parts)}
        """, (user_id,))
        conn.commit()
except Exception:
    logger.warning("[Analytics] SQLite sync failed for record_milestone user=%s event=%s", user_id, event)
```

For `update_session(user_id, is_pwa)` -- after line 128 (the Postgres RETURNING row is available), add SQLite write using the returned `row["session_count"]` and `row["pwa_session_count"]` values. Only write if `row` is not None.

For `create_user_milestones(user_id, ...)` -- after the Postgres write succeeds (line 63), initialize a `user_activity` row in SQLite with defaults.

**Critical rules:**
- SQLite failures must NEVER fail the request. Always `try/except Exception` with `logger.warning`.
- Use `get_user_db_connection(user_id)` -- never raw sqlite3.connect.
- Call `conn.commit()` after writes (TrackedConnection needs explicit commit to trigger R2 sync tracking).
- Import `get_user_db_connection` inside the try block (lazy import pattern, same as `confirm_reservation` at user_db.py line 432).

### 5. `src/backend/app/session_init.py`

**Current state (lines 112-124):** Session init runs backfills sequentially:
```python
# 6. T970: Backfill completed_quests from credit_transactions
try:
    from .services.user_db import backfill_completed_quests
    backfill_completed_quests(user_id)
except Exception as e:
    logger.error(f"T970: Failed to backfill completed quests: {e}")

# 7. T985: Backfill preferences from profile DB to user.sqlite
try:
    from .services.user_db import backfill_preferences_from_profile
    backfill_preferences_from_profile(user_id)
except Exception as e:
    logger.error(f"T985: Failed to backfill preferences: {e}")
```

**Change:** Add step 8 (or renumber) after the preferences backfill:
```python
# 8. T3080: Backfill user activity from Postgres to user.sqlite
try:
    from .services.user_db import backfill_user_activity
    backfill_user_activity(user_id)
except Exception as e:
    logger.error(f"T3080: Failed to backfill user activity: {e}")
```

Note: There's already a step 8 (archive_completed_projects at line 126). Slot this as step 8 and renumber the existing steps 8-9 to 9-10.

## Test Plan

Write tests in `src/backend/tests/test_user_activity_sync.py`. Follow the patterns in `test_analytics.py` and `test_analytics_dashboards.py`.

**Fixtures needed:**
- `pg_conn` (from conftest.py) -- provides Postgres with auto-rollback
- A fixture that creates a test user in Postgres + creates user_milestones via `create_user_milestones()`
- A fixture or helper that reads from user.sqlite to verify dual-writes

**Test cases:**

1. **test_record_milestone_dual_writes** -- Call `record_milestone(user_id, "game_created")`. Verify Postgres `user_flow_events` has the row. Verify user.sqlite `user_activity_events` has event="game_created", count=1. Verify user.sqlite `user_activity.last_active_at` is set.

2. **test_record_milestone_increments_sqlite_count** -- Call `record_milestone` twice for same event. Verify user.sqlite `user_activity_events.count` == 2.

3. **test_update_session_syncs_to_sqlite** -- Create milestones, then call `update_session(user_id)` with a >30 min gap (set last_active_at in the past first). Verify user.sqlite `user_activity.session_count` matches the Postgres value.

4. **test_backfill_user_activity** -- Insert test data directly into Postgres `user_milestones` + `user_flow_events`. Call `backfill_user_activity(user_id)`. Verify user.sqlite tables match. Call again -- verify idempotent (counts don't double).

5. **test_sqlite_failure_does_not_break_milestone** -- Mock `get_user_db_connection` to raise. Call `record_milestone`. Verify Postgres write still succeeded. Verify warning was logged.

6. **test_create_milestones_initializes_sqlite** -- Call `create_user_milestones(...)`. Verify user.sqlite has a `user_activity` row with session_count=0.

**Important test gotcha:** The existing `test_analytics.py` imports `MILESTONE_EVENTS` from analytics.py, but the current code exports `FLOW_EVENTS` (renamed in T3040 merge). If you see an ImportError from that file, fix the import to `FLOW_EVENTS` -- it's a pre-existing issue from the merge.

## Verification

After implementation, run:
```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
cd src/backend && .venv/Scripts/python.exe run_tests.py 2>&1 > /tmp/test-output.log; echo "exit: $?"
```

If tests pass, commit and update PLAN.md status to TESTING.

## What NOT to Do

- Don't add fallback/default logic if SQLite data is missing -- the project rule is "correct data, not workarounds" (see CLAUDE.md)
- Don't use `useEffect` or reactive patterns -- this is backend-only
- Don't modify the Postgres write paths -- they stay exactly as-is, SQLite writes are additive
- Don't add user_id to `user_activity_events` -- each user.sqlite is already per-user, so event is sufficient as PK
- Don't create any frontend changes -- this is backend-only plumbing
