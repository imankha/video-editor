# T71: Gallery Shows File Names Instead of Proper Names

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-02-11
**Updated:** 2026-02-11

## Problem

The gallery panel inconsistently displays item names:
- Some items show proper project/clip names (e.g., "Great Dribbling", "Custom Project")
- Many items show raw file names (e.g., "final 36 ea9...", "final 64 74f...", "final 22 cab...")

All gallery items should display their proper project name, not the underlying filename.

**Screenshot:** `screenshots/galary.png`

## Solution

Ensure the gallery always displays the project name (or a meaningful derived name) rather than the raw filename. The data should come from the `final_videos` or `projects` table where proper names are stored.

## Context

### Relevant Files
- `src/frontend/src/components/DownloadsPanel.jsx` - Gallery UI component
- `src/backend/app/routers/downloads.py` - Downloads/gallery API endpoint
- `src/backend/app/database.py` - Database queries for final_videos

### Technical Notes
- The `final_videos` table has a `project_id` FK to `projects` which has `name`
- Some downloads may have been created before proper naming was implemented
- Need to check what field is being used for display and ensure it falls back to project name

## Implementation

### Steps
1. [ ] Check DownloadsPanel to see what field is used for display name
2. [ ] Check downloads API to see what name field is returned
3. [ ] Ensure API returns project name (joined from projects table)
4. [ ] Update frontend to use the proper name field
5. [ ] Handle edge cases (deleted projects, missing names)

## Acceptance Criteria

- [ ] All gallery items show project name, not filename
- [ ] Names are properly truncated with ellipsis if too long
- [ ] Works for both new and existing exports
- [ ] Fallback to filename only if project name is truly unavailable
