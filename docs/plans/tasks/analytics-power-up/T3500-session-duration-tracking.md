# T3500: Session Duration Tracking

**Status:** TODO
**Priority:** P1
**Impact:** 8 | **Complexity:** 4

## Summary

Track total time spent per user by sessionizing the event stream. When `update_session()` detects a 30min gap, close the previous session (recording its duration) and accumulate into `total_usage_seconds`. Surface in admin user list as formatted time (e.g., "1h 5m").

## Why

We track session count but not session duration. "12 sessions" tells you frequency but not engagement depth. A user with 12 sessions averaging 2 minutes is very different from one averaging 45 minutes. Total time spent is the most fundamental engagement metric we're missing.

## Current State

`update_session()` in `analytics.py`:
- Checks if `last_active_at < now() - 30 minutes` → new session
- Increments `session_started` count in `user_actions`
- Updates `last_active_at` to now
- Does NOT record when the previous session ended or its duration

## Design

### New columns

**Postgres `user_segments`:**
- `total_usage_seconds INTEGER NOT NULL DEFAULT 0` — cumulative time spent
- `current_session_start TIMESTAMPTZ` — when the active session began

**SQLite `user_activity`:**
- `total_usage_seconds INTEGER NOT NULL DEFAULT 0` — mirror for admin reads

### Session lifecycle in `update_session()`

```
Request comes in → check last_active_at

CASE 1: last_active_at < 30 min ago (new session)
  → previous_session_duration = last_active_at - current_session_start
  → total_usage_seconds += previous_session_duration
  → current_session_start = now()
  → last_active_at = now()

CASE 2: last_active_at >= 30 min ago (same session)
  → last_active_at = now()
  (session is still open; duration computed on next gap or on read)

CASE 3: first ever request (no segment row yet)
  → current_session_start = now()
  → last_active_at = now()
```

### Computing "current" total for display

For the admin user list, total time = `total_usage_seconds` + (if currently in a session: `now() - current_session_start`, capped at 30min to avoid inflating stale sessions).

### Admin display format

| Seconds | Display |
|---------|---------|
| < 60 | `<1m` |
| 60–3599 | `Xm` |
| 3600–86399 | `Xh Ym` |
| >= 86400 | `Xd Yh` |

## Migration

- Postgres migration: add `total_usage_seconds` and `current_session_start` to `user_segments`
- SQLite user_db migration: add `total_usage_seconds` to `user_activity`
- No backfill possible — we don't have historical session boundaries. Starts accumulating from deploy forward.

## Files to Change

- `analytics.py` — update `update_session()` with session close/open logic
- `admin.py` — compute effective total_usage_seconds per user, format for display
- `pg.py` — add new columns to `_SCHEMA_DDL`
- `user_db.py` — add column to `_USER_DB_SCHEMA`
- Postgres migration v012
- SQLite user_db migration v004
- `UserTable.jsx` — render formatted duration column

## Dependencies

- T3470 (session_started tracking) — already done, provides the 30min gap detection

## Notes

- The 30min session timeout matches the existing `update_session()` gap threshold
- `current_session_start` is set to NULL when no session is active (user hasn't been seen in >30min). On next request, a new session starts.
- For users with no `current_session_start` (pre-migration), treat first post-migration request as session start with 0 accumulated time.
