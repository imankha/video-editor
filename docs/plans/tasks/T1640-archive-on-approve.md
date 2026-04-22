# T1640: Archive Project on User Approval

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-04-20
**Updated:** 2026-04-20

## Problem

Completed projects (those with a final export) are never automatically archived. The only way to archive is via a manual migration script (`scripts/archive_completed_projects.py`). This means the SQLite DB grows with working_clips and working_videos rows for projects the user is done with, bloating R2 sync.

Ideally, the user clicks an "approve" action on a completed project card in the gallery and the project animates out and gets archived to R2.

## Solution

Add an "approve" button to completed project cards in the DownloadsPanel. On click:
1. Frontend fires archive request, plays an animate-out transition on the card
2. Backend archives the project (serialize to R2 JSON, delete working data from DB)
3. Card disappears from the active gallery view

The archive logic already exists in `project_archive.py:archive_project()` -- just needs a route and a frontend trigger.

## Context

### Relevant Files
- `src/backend/app/services/project_archive.py` - `archive_project()` already implemented
- `src/backend/app/routers/projects.py` - Add POST endpoint for archiving
- `src/frontend/src/components/DownloadsPanel.jsx` - Add approve button to project cards
- `src/frontend/src/hooks/useDownloads.js` - Add archive API call + remove card from list

### Related Tasks
- T66 (Database Completed Projects Split) - Original design that created archive infrastructure

### Technical Notes
- `archive_project()` serializes project + working_clips + working_videos to JSON, uploads to `{user_id}/archive/{project_id}.json` on R2, deletes working data from DB, keeps the projects row with `archived_at` timestamp
- Gallery already handles restore from archive when opening a project (`handleOpenProject` in DownloadsPanel)
- Card animation should be a CSS transition (slide-out or fade-out) before removing from DOM
- After archiving, the card should either disappear entirely or show in a dimmed "archived" state (user preference TBD)

## Implementation

### Steps
1. [ ] Backend: Add `POST /projects/{id}/archive` endpoint in projects router that calls `archive_project()`
2. [ ] Frontend: Add approve/archive button (checkmark or similar) to project cards for completed projects
3. [ ] Frontend: Wire button to call archive endpoint
4. [ ] Frontend: Animate card out on successful archive (CSS transition)
5. [ ] Frontend: Remove archived project from downloads list state
6. [ ] Frontend: Change default mode when opening a completed reel from Overlay to Framing (see below)

### Bundled: Default to Framing when opening completed reels

When clicking into a completed reel from the gallery, the app should open in Framing mode (not Overlay). Two locations hardcode overlay:

- `App.jsx:597` -- `setEditorMode(EDITOR_MODES.OVERLAY)` in the `onOpenProject` callback
- `ProjectsScreen.jsx:344` -- `handleSelectProjectWithMode(projectId, { mode: 'overlay' })`

Change both to use `EDITOR_MODES.FRAMING` / `{ mode: 'framing' }`.

## Acceptance Criteria

- [ ] Completed project cards show an approve/archive button
- [ ] Clicking the button archives the project to R2
- [ ] Card animates out smoothly after successful archive
- [ ] Archived project can still be restored if user opens it from gallery later
- [ ] Error state shown if archive fails (e.g., R2 unavailable)
- [ ] Opening a completed reel from the gallery defaults to Framing mode (not Overlay)
