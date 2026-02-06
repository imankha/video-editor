---
name: database-schema
description: "SQLite database patterns for the video editor. Version-based identity, latest queries, FK constraints. Apply when writing queries, creating tables, or working with versioned data."
license: MIT
author: video-editor
version: 1.0.0
---

# Database Schema

SQLite patterns for version-based data management.

## When to Apply
- Writing database queries
- Creating or modifying tables
- Working with versioned clips/videos
- Debugging "wrong version" issues

## Core Concept: Version-Based Identity

Clips and videos use **version columns** instead of relying solely on primary keys. Multiple versions of the same logical item can exist, and only the latest is shown (except in Gallery).

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Version Identity | CRITICAL | `db-version-` |
| 2 | Latest Queries | HIGH | `db-latest-` |
| 3 | FK Constraints | MEDIUM | `db-fk-` |

---

## Key Tables

### raw_clips
Source clips from Annotate mode. Identity: `end_time` (not ID).

```sql
raw_clips (
    id INTEGER PRIMARY KEY,
    filename TEXT,
    start_time REAL,
    end_time REAL,           -- IDENTITY KEY
    boundaries_version INT,   -- Increments when times change
    boundaries_updated_at TIMESTAMP,
    game_id INT,
    auto_project_id INT,
    ...
)
```

### working_clips
Clips in projects with framing edits. Identity: `raw_clip.end_time` OR `uploaded_filename`.

```sql
working_clips (
    id INTEGER PRIMARY KEY,
    project_id INT,
    raw_clip_id INT,          -- FK to raw_clips (nullable)
    uploaded_filename TEXT,    -- For direct uploads (no raw_clip)
    version INT DEFAULT 1,     -- Increments on re-export
    raw_clip_version INT,      -- Snapshot of boundaries_version at import
    crop_data TEXT,            -- JSON
    timing_data TEXT,          -- JSON
    segments_data TEXT,        -- JSON
    ...
)
```

### working_videos / final_videos
Output videos. Identity: `project_id` + `version`.

```sql
working_videos (
    id INTEGER PRIMARY KEY,
    project_id INT,
    filename TEXT,
    version INT DEFAULT 1,     -- Increments on re-export
    highlights_data TEXT,      -- JSON
    ...
)
```

---

## Latest Query Pattern

To get only the latest version of each item:

```sql
-- Latest working clips for a project
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
ORDER BY wc.sort_order
```

### Helper Function

Use `app/queries.py` for common patterns:

```python
from app.queries import latest_working_clips_subquery

cursor.execute(
    f"SELECT * FROM working_clips WHERE id IN ({latest_working_clips_subquery()}) AND project_id = ?",
    (project_id,)
)
```

---

## Version Identity Rules

| Table | Identity Column | Version Column |
|-------|-----------------|----------------|
| raw_clips | `end_time` | `boundaries_version` |
| working_clips | `COALESCE(rc.end_time, uploaded_filename)` | `version` |
| working_videos | `project_id` | `version` |
| final_videos | `project_id` | `version` |

---

## FK Constraints

Use `ON DELETE CASCADE` for child tables:

```sql
CREATE TABLE annotations (
    id INTEGER PRIMARY KEY,
    game_id INTEGER NOT NULL,
    ...
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
```

This ensures:
- Deleting a game deletes all its annotations
- Deleting a project deletes all its clips and videos
- No orphaned records

---

## Common Pitfalls

### Pitfall 1: Querying by ID instead of identity

```sql
-- BAD: Gets a specific row, may not be latest
SELECT * FROM working_clips WHERE id = 123;

-- GOOD: Gets latest version of the logical clip
SELECT * FROM working_clips WHERE id IN (
    SELECT id FROM (...latest query...)
) AND raw_clip_id = 456;
```

### Pitfall 2: Forgetting to increment version

```python
# BAD: Overwrites without versioning
cursor.execute("UPDATE working_clips SET crop_data = ? WHERE id = ?", ...)

# GOOD: Insert new version
cursor.execute("""
    INSERT INTO working_clips (project_id, raw_clip_id, version, crop_data, ...)
    SELECT project_id, raw_clip_id, version + 1, ?, ...
    FROM working_clips WHERE id = ?
""", ...)
```

---

## Complete Rules

See individual rule files in `rules/` directory.
