# T1640: Auto-Archive Completed Projects on Login

**Status:** TESTING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-04-20
**Updated:** 2026-04-23

## Problem

Completed projects (those with a final export) are never automatically archived. The only way to archive is via a manual migration script (`scripts/archive_completed_projects.py`). This means the SQLite DB grows with working_clips and working_videos rows for projects the user is done with, bloating R2 sync and slowing down every request.

## Solution

Auto-archive all completed projects on session init (login). A project is "complete" when it has a `final_video_id`. During the current session, completed projects stay live in the DB so the user can re-edit and re-export. On next login, they get archived automatically.

This runs in `session_init.py` alongside the existing cleanup tasks (stale restore cleanup, DB bloat cleanup). No UI changes needed -- no approve button, no user action required.

Archive logic already exists in `project_archive.py:archive_project()`. Restore already works transparently when a user opens an archived project from the gallery.

## Context

### Relevant Files
- `src/backend/app/session_init.py` - Add archive step to `user_session_init()`
- `src/backend/app/services/project_archive.py` - `archive_project()` already implemented
- `src/backend/app/routers/projects.py` - Auto-restore on project open already works

### Related Tasks
- T66 (Database Completed Projects Split) - Original design that created archive infrastructure

### Technical Notes
- `archive_project()` serializes project + working_clips + working_videos to JSON, uploads to `{user_id}/archive/{project_id}.json` on R2, deletes working data from DB, keeps the projects row with `archived_at` timestamp
- Gallery already handles restore from archive when opening a project (auto-restore in `GET /projects/{id}`)
- `cleanup_stale_restored_projects()` already runs in session_init -- new step goes next to it
- Only archive projects where `final_video_id IS NOT NULL` and `archived_at IS NULL`

## Implementation

### Steps
1. [ ] Backend: Add `archive_completed_projects()` function in `project_archive.py` that queries for projects with `final_video_id IS NOT NULL AND archived_at IS NULL`, then calls `archive_project()` on each
2. [ ] Backend: Call `archive_completed_projects()` in `session_init.py` step 8 (cleanup tasks), after the existing stale restore cleanup
3. [ ] Backend: Remove the comment in `overlay.py:2126-2127` about not archiving immediately -- the session-based approach replaces that design decision

### Bundled: Default to Framing when opening completed reels

When clicking into a completed reel from the gallery, the app should open in Framing mode (not Overlay). Two locations hardcode overlay:

- `App.jsx:597` -- `setEditorMode(EDITOR_MODES.OVERLAY)` in the `onOpenProject` callback
- `ProjectsScreen.jsx:344` -- `handleSelectProjectWithMode(projectId, { mode: 'overlay' })`

Change both to use `EDITOR_MODES.FRAMING` / `{ mode: 'framing' }`.

## Acceptance Criteria

- [ ] On login, all projects with a final export are archived to R2
- [ ] Projects without a final export are never archived
- [ ] During the current session, completed projects remain live (not archived)
- [ ] Archived projects auto-restore transparently when opened from gallery
- [ ] Opening a completed reel from the gallery defaults to Framing mode (not Overlay)
