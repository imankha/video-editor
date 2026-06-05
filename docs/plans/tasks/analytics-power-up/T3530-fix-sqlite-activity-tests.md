# T3530: Fix SQLite user_activity Tests After Analytics Normalization

## Context

The analytics normalization (T3450) changed `create_user_segment` to no longer write to SQLite `user_activity`, and changed `update_session` to write to `user_action_log` instead of `user_activity`. Several tests in `test_user_activity_sync.py` still assert against the old `user_activity` table behavior.

## Problem

### 1. `TestCreateSegmentInitializesSqlite`
```python
def test_create_segment_initializes_sqlite(self, pg_conn):
    create_user_segment("user-a", "organic", None, "otp")
    activity = _get_sqlite_activity("user-a")
    assert activity is not None  # FAILS: create_user_segment no longer writes to SQLite
```

The old `create_user_milestones` inserted a row into `user_activity`. The new `create_user_segment` doesn't. This test should either:
- Be removed (if user_activity initialization is no longer expected)
- Be updated to verify `user_action_log` or some other mechanism

### 2. `TestUpdateSessionSync.test_update_session_syncs_to_sqlite`
```python
def test_update_session_syncs_to_sqlite(self, pg_conn):
    update_session("user-a")
    activity = _get_sqlite_activity("user-a")
    assert activity is not None
    assert activity["session_count"] == pg_row["count"]  # user_activity.session_count no longer written
```

`update_session` now writes `session_started` to `user_action_log`, not to `user_activity.session_count`. The test should verify the action_log write instead.

### 3. `TestBackfillUserActivity`
This test may still be valid since `backfill_user_activity()` reads from Postgres and writes to SQLite. But verify it still works with the new schema (user_segments + user_actions instead of user_milestones + user_flow_events).

## Requirements

1. Audit all tests in `test_user_activity_sync.py` for stale `user_activity` assumptions
2. Update or remove tests that assert against `user_activity` writes from `create_user_segment` and `update_session`
3. Add new tests verifying `user_action_log` writes:
   - `record_milestone` writes to `user_action_log` with correct action + context JSON
   - `update_session` writes `session_started` to `user_action_log` with `{"is_pwa": bool}` context
4. Verify `backfill_user_activity` still works end-to-end
5. Run full test suite: `pytest tests/test_user_activity_sync.py tests/test_analytics.py -v`

## Files to Change
- `src/backend/tests/test_user_activity_sync.py`
- Possibly `src/backend/app/services/user_db.py` (if `backfill_user_activity` needs updates)

## Done When
- All stale `user_activity` assertions updated or removed
- New tests cover `user_action_log` dual-write behavior
- `backfill_user_activity` test passes with new schema
- Full test suite passes
