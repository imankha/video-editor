# T2530: Index Export Jobs for Unacknowledged Query

**Epic:** [Page Load Optimization](EPIC.md)
**Priority:** P0
**Complexity:** 1
**Impact:** 7
**Status:** TESTING

## Problem

`GET /api/exports/unacknowledged` runs a query with `WHERE status IN ('complete','error') AND acknowledged_at IS NULL AND completed_at >= datetime('now', '-24 hours')` but only `idx_export_jobs_status` exists. The query does a partial table scan + LEFT JOIN to projects.

## Evidence

HAR: 487ms server wait time for this endpoint. The query at `exports.py:693-704` has no covering index for the `acknowledged_at IS NULL` and `completed_at` filter.

Current indexes (database.py:715-726):
- `idx_export_jobs_project` on `(project_id)`
- `idx_export_jobs_status` on `(status)`
- `idx_export_jobs_type_status` on `(type, status)`

## Implementation

Add a composite index in `ensure_database()`:

```python
cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_export_jobs_unacknowledged
    ON export_jobs(status, acknowledged_at, completed_at DESC)
""")
```

This covers the exact WHERE clause + ORDER BY of the unacknowledged query.

## Test Plan

- [ ] Query EXPLAIN shows index scan instead of table scan
- [ ] `/api/exports/unacknowledged` response time < 100ms (from 487ms)
- [ ] Existing export queries unaffected
- [ ] Backend starts without errors

## Files

- `src/backend/app/database.py` (around line 726)
