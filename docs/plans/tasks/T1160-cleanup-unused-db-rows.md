# T1160: Clean Up Unused Database Rows

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

Several tables accumulate rows that are never read again. This inflates profile.sqlite, which is uploaded to R2 on every write request. Smaller DB = faster sync.

Current cleanup (`cleanup_database_bloat`) handles:
- Old `working_videos` versions (keeps latest per project) ✓
- Old `export_jobs` (deletes completed/errored older than 7 days) ✓

Not cleaned up:
- **`working_clips` old versions** — each re-export creates a new version row with `crop_data`, `timing_data`, `segments_data` JSON. Only the latest version per (project_id, raw_clip_id) is ever read. Old versions accumulate indefinitely.
- **`before_after_tracks`** — rows accumulate per export. Each overlay export creates new tracking rows, but old ones from prior exports are never read.
- **`modal_tasks`** — tracks GPU job status. Completed tasks are never cleaned up.

## How much space

Each `working_clips` row with JSON data is ~300-500 bytes. A user who re-exports the same clip 10 times has 9 dead rows × ~400 bytes = ~3.6KB per clip. With 15 clips, that's ~54KB of dead data — significant when the DB target is 400KB.

`before_after_tracks` rows are smaller (~100 bytes each) but also accumulate.

## Solution

Add to `cleanup_database_bloat()` in `src/backend/app/services/project_archive.py`:

### 1. Prune old working_clips versions

```sql
DELETE FROM working_clips
WHERE id NOT IN (
    SELECT wc1.id FROM working_clips wc1
    WHERE wc1.version = (
        SELECT MAX(wc2.version) FROM working_clips wc2
        WHERE wc2.project_id = wc1.project_id
        AND wc2.raw_clip_id = wc1.raw_clip_id
    )
)
```

Same pattern as the existing `working_videos` cleanup.

### 2. Prune orphaned before_after_tracks

```sql
DELETE FROM before_after_tracks
WHERE final_video_id NOT IN (
    SELECT fv.id FROM final_videos fv
    JOIN projects p ON fv.project_id = p.id
    WHERE p.final_video_id = fv.id
)
```

Only keep tracks for the current final video of each project.

### 3. Prune completed modal_tasks older than 24h

```sql
DELETE FROM modal_tasks
WHERE status IN ('complete', 'error', 'cancelled')
AND updated_at < datetime('now', '-1 day')
```

## Context

### Relevant Files
- `src/backend/app/services/project_archive.py:341` — `cleanup_database_bloat()` (add cleanup here)
- `src/backend/app/session_init.py:130` — where cleanup is called (once per user per server lifetime)
- `src/backend/app/database.py:53` — size thresholds (400KB warning, 768KB critical)

### Related Tasks
- T1020: Fast R2 sync (smaller DB = faster upload)
- T66: Project archive system (original size management)

## Acceptance Criteria

- [ ] Old `working_clips` versions pruned (keep latest per project+raw_clip_id)
- [ ] Orphaned `before_after_tracks` removed
- [ ] Old `modal_tasks` removed
- [ ] VACUUM runs after cleanup (already does)
- [ ] Logged counts for each cleanup category
