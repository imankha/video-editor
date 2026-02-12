# T66: Database Completed Projects Split

**Status:** DONE
**Impact:** MEDIUM
**Complexity:** MEDIUM
**Created:** 2026-02-11
**Updated:** 2026-02-11

## Problem

The SQLite database file size grows with all projects (active and completed). Loading the full database on startup is slower than necessary since completed projects are rarely accessed.

## Solution

Archive completed projects as JSON files in R2 storage. When a project is exported (completed), serialize its data to JSON and remove it from the database. The `final_videos` table keeps the row for gallery listing. Users can restore archived projects via the gallery folder icon.

**Design Document:** [T66-design.md](T66-design.md)

## Validation Results (2026-02-11)

| Metric | Value |
|--------|-------|
| Original database size | 897 KB |
| After removing completed | 262 KB |
| **Reduction** | **70.8%** |
| Threshold | 30% |

**Decision: GO** - The size reduction significantly exceeds the 30% threshold.

Key findings:
- 29 of 31 projects (93.5%) were completed
- `highlights_data` column alone contained 453 KB (50%+ of the database)

## High-Level Approach

1. **Archive on export**: When project exports successfully, serialize project/working_clips/working_videos to JSON, upload to R2 at `{user_id}/archive/{project_id}.json`, delete from DB
2. **Keep final_videos**: The `final_videos` row stays in DB for gallery listing
3. **Restore from gallery**: User clicks folder icon → restore JSON to DB → navigate to project
4. **Stale cleanup**: On app startup, re-archive any restored projects that are >48 hours old and haven't been edited

## Database Schema Change

```sql
ALTER TABLE projects ADD COLUMN restored_at TIMESTAMP DEFAULT NULL
```

- Set to current timestamp when project is restored from archive
- Cleared to NULL when project is edited
- On startup: re-archive projects where `restored_at` is set and >48 hours old

## Relevant Files

See [T66-design.md](T66-design.md) for complete implementation plan.

Key files:
- `src/backend/app/services/project_archive.py` - New file for archive/restore logic
- `src/backend/app/database.py` - Add `restored_at` column
- `src/backend/app/routers/export/overlay.py` - Trigger archive after export
- `src/backend/app/routers/downloads.py` - Restore endpoint
- `src/backend/app/routers/clips.py` - Clear restored_at on edit
- `src/frontend/src/components/DownloadsPanel.jsx` - Folder icon action
- `src/frontend/src/components/ProjectManager.jsx` - Remove completed filter
- `src/backend/scripts/archive_completed_projects.py` - Migration script

## Acceptance Criteria

### Validation Phase
- [x] Current database size measured (897 KB)
- [x] Clone created without completed projects (262 KB)
- [x] Size comparison documented (70.8% reduction)
- [x] Go/no-go decision made (GO)

### Implementation Phase
- [x] Completing a project archives data to R2 JSON
- [x] Archived project data deleted from active DB
- [x] `final_videos` row remains in DB (gallery works)
- [x] Gallery folder icon restores project to DB and navigates to editor
- [x] Archive JSON deleted after restore
- [x] Restored project gets `restored_at` timestamp
- [x] Any edit clears `restored_at` to NULL
- [x] App startup re-archives projects with `restored_at` older than 48 hours
- [x] Project filter no longer shows "completed" option
- [x] Migration script for existing completed projects
- [x] Tests pass (333 backend, 378/379 frontend - 1 pre-existing failure)
