# db-latest-query

**Priority:** HIGH
**Category:** Latest Queries

## Rule
When querying versioned tables (working_clips, working_videos, final_videos), always use the "latest" query pattern to get only the most recent version of each logical item.

## Rationale
Multiple versions of the same clip/video can exist in the database:
- Re-exporting a clip creates a new version
- Changing boundaries creates a new version
- Gallery shows all versions, other views show only latest

Without the latest query, you'll show stale/duplicate data.

## The Pattern

```sql
SELECT * FROM working_clips wc
WHERE wc.id IN (
    SELECT id FROM (
        SELECT wc2.id,
               ROW_NUMBER() OVER (
                   PARTITION BY COALESCE(rc.end_time, wc2.uploaded_filename)
                   ORDER BY wc2.version DESC
               ) as rn
        FROM working_clips wc2
        LEFT JOIN raw_clips rc ON wc2.raw_clip_id = rc.id
        WHERE wc2.project_id = ?
    ) WHERE rn = 1
)
```

**How it works:**
1. `PARTITION BY` groups rows by their identity (end_time or uploaded_filename)
2. `ORDER BY version DESC` puts latest version first
3. `ROW_NUMBER()` assigns 1 to the latest
4. `WHERE rn = 1` filters to only the latest

## Incorrect Example

```python
# BAD: Returns all versions, including old ones
cursor.execute(
    "SELECT * FROM working_clips WHERE project_id = ?",
    (project_id,)
)
clips = cursor.fetchall()  # May have duplicates!
```

## Correct Example

```python
from app.queries import latest_working_clips_subquery

# GOOD: Returns only latest version of each clip
cursor.execute(
    f"""SELECT * FROM working_clips
        WHERE id IN ({latest_working_clips_subquery()})
        AND project_id = ?
        ORDER BY sort_order""",
    (project_id,)
)
clips = cursor.fetchall()  # One row per logical clip
```

## Helper Functions

```python
# app/queries.py provides these helpers:
from app.queries import (
    latest_working_clips_subquery,
    latest_working_videos_subquery,
    latest_final_videos_subquery,
)
```

## When NOT to Use Latest

- **Gallery/Downloads**: Shows all versions so users can access old exports
- **Version history UI**: If you ever build one
- **Debugging**: When investigating version issues
