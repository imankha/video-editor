# T73: Project Card Shows Wrong Clip Count

**Status:** TESTING
**Impact:** LOW
**Complexity:** LOW
**Created:** 2026-02-12

## Problem

The "Great Dribbeling" project has 1 clip but the project card displays "2 clips".

## Expected Behavior

Project card should show the correct number of clips in the project.

## Investigation Areas

- `src/frontend/src/components/ProjectCard.jsx` - Where clip count is displayed
- Backend API response - Check if `clip_count` field is correct
- Database query - Verify counting logic for working_clips

## Root Cause

The `clip_stats` subquery in `projects.py` used a `NOT EXISTS` pattern to filter to latest versions. This failed when **duplicate clips existed at the same version level** (e.g., two clips with version=7 and same identity). Neither had a "newer version" to exclude it, so both got counted.

Data example from "Great Dribbling" project:
```
version=7: id=117 AND id=118 (both have identity=4313.0)
```

## Fix

Changed from `NOT EXISTS` pattern to `ROW_NUMBER()` pattern (matching `queries.py`):

```sql
-- Uses ROW_NUMBER to select exactly ONE clip per identity
SELECT ... FROM (
    SELECT wc.*, ROW_NUMBER() OVER (
        PARTITION BY wc.project_id, COALESCE(rc.end_time, wc.uploaded_filename)
        ORDER BY wc.version DESC, wc.id DESC
    ) as rn
    FROM working_clips wc
    LEFT JOIN raw_clips rc ON wc.raw_clip_id = rc.id
) latest_clips
WHERE rn = 1
GROUP BY project_id
```

**File:** `src/backend/app/routers/projects.py:292-316`

## Acceptance Criteria

- [ ] Project card displays correct clip count
- [ ] Count matches actual clips in project
