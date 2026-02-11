# T66: Database Completed Projects Split

**Status:** TODO
**Impact:** MEDIUM
**Complexity:** MEDIUM
**Created:** 2026-02-11
**Updated:** 2026-02-11

## Problem

The SQLite database file size grows with all projects (active and completed). Loading the full database on startup may be slower than necessary since completed projects are rarely accessed.

## Solution

Split completed projects into a separate "archive" database that is not loaded during normal operation. This reduces the active database size and improves startup/sync times.

## Design

### Two Databases
- **Active database**: Contains in-progress projects and recently-touched completed projects
- **Archive database**: Contains completed projects that haven't been touched in 48+ hours

### Project Lifecycle

1. **New project** → Active DB
2. **Project completed** (exported to gallery) → Stays in Active DB initially
3. **48 hours without being touched** → Moves to Archive DB
4. **User opens from Gallery** → Moves back to Active DB, timer resets
5. **User edits project** → Timer resets

### UI Changes

- **Project filter**: Remove "completed" filter option - completed projects are not accessible from the project list
- **Gallery folder icon**: Currently "opens game" → Change to "open project"
  - Clicking moves the project from Archive to Active DB
  - Opens the project in the editor
- **Touch tracking**: Record `last_touched_at` timestamp for completed projects in Active DB

### Background Process

A background job (or on-startup check) moves completed projects from Active → Archive when:
- Status is "completed"
- `last_touched_at` is older than 48 hours

## Validation Phase (Before Implementation)

**Goal**: Confirm this work will actually reduce Active DB size meaningfully.

### Test Procedure

1. Clone the current database
2. Delete all completed project data from the clone:
   - `working_videos` where status = 'completed'
   - Related `working_clips`, `highlight_regions`, etc. (cascade)
3. Run `VACUUM` to reclaim space
4. Compare file sizes

### Success Criteria

- If Active DB would be significantly smaller (e.g., 30%+ reduction), proceed with implementation
- If minimal savings, reconsider or defer the task

## Implementation Plan (After Validation)

### Backend Changes

1. **Database schema**
   - Add `last_touched_at` column to `working_videos`
   - Create archive database with identical schema

2. **Archive service**
   - `move_to_archive(project_id)` - Move project and related data to archive DB
   - `restore_from_archive(project_id)` - Move project back to active DB
   - `check_and_archive_stale()` - Background job to archive stale completed projects

3. **API changes**
   - `GET /api/gallery/{video_id}/open-project` - Restore from archive if needed, return project
   - Update project status changes to set `last_touched_at`

4. **R2 sync**
   - Sync both databases separately
   - Archive DB syncs less frequently (on change only)

### Frontend Changes

1. **Project filters**
   - Remove "completed" option from status filter
   - Update filter UI accordingly

2. **Gallery**
   - Change folder icon action from "open game" to "open project"
   - Handle loading state while restoring from archive
   - Navigate to project after restore

3. **Settings store**
   - Remove 'completed' from valid filter values

## Relevant Files

- `src/backend/app/database.py` - Database setup, migrations
- `src/backend/app/routers/projects.py` - Project CRUD
- `src/backend/app/routers/gallery.py` - Gallery endpoints
- `src/frontend/src/screens/GalleryScreen.jsx` - Gallery UI
- `src/frontend/src/components/ProjectFilters.jsx` - Filter UI
- `src/frontend/src/stores/settingsStore.js` - Filter persistence

## Acceptance Criteria

### Validation Phase
- [ ] Current database size measured
- [ ] Clone created without completed projects
- [ ] Size comparison documented
- [ ] Go/no-go decision made

### Implementation Phase (if validated)
- [ ] Archive database schema created
- [ ] Move/restore logic implemented
- [ ] 48-hour stale check implemented
- [ ] Gallery "open project" working
- [ ] Project filter updated (no "completed" option)
- [ ] R2 sync handles both databases
- [ ] Tests pass
