# Project Status Regression on Backward Steps

## Status: DONE (pending user testing)

## Problem Statement

When a user takes a "backward step" in the workflow (e.g., re-framing an already completed project), the project card and database don't reflect the new state:

1. Project remains marked as "completed" even though new framing export is in progress
2. Export events (progress indicator) don't show on the project card
3. Database status doesn't regress to match the current workflow step

## Expected Behavior

The project status should always reflect the **most recent output state**:

| Action | Expected Status |
|--------|----------------|
| Start new project | Not Started |
| Add clips, no framing | Not Started |
| Complete framing export | In Framing (or Framing Complete) |
| Complete overlay export | Complete |
| **Re-frame a completed project** | **In Framing** (regress from Complete) |
| **Re-overlay a framed project** | **In Overlay** (regress from Complete) |

## Investigation Findings (2026-02-03)

### Database Architecture
The `projects` table has NO explicit `status` column. Status is derived from:
- `working_video_id` IS NOT NULL → "In Overlay" (framing complete)
- `final_video_id` IS NOT NULL → "Complete" (overlay complete)
- Otherwise → "Not Started" or "Editing"

### Current Regression Logic
**Framing export DOES clear `final_video_id`** but only at the END of export (when working_video is created).
- Lines in framing.py: 397, 558, 1123
- Lines in multi_clip.py: 1138

### The Problem
The status regression happens at export COMPLETION, not at export START:
1. User starts re-framing a "Complete" project
2. During export: `final_video_id` still set → status shows "Complete"
3. Export completes: `final_video_id = NULL` → status changes to "In Overlay"

User sees "Complete" during the entire export, then it suddenly changes.

### Frontend Export Indicator
The frontend ProjectCard DOES check for active exports (line 1029-1038):
```javascript
const storeExport = Object.values(activeExports).find(
  (exp) => exp.projectId === project.id && (exp.status === 'pending' || exp.status === 'processing')
);
const isExporting = ... storeExport?.type || null;
```

And shows "Exporting..." when active (lines 1132-1136). But this relies on:
1. Export being in the store (may not survive page refresh)
2. The underlying status still shows as "Complete" in the progress bar

### Solution
Clear `final_video_id` at the START of framing export, not just at the end.
This immediately regresses status from "Complete" to "In Overlay".

## Implementation (2026-02-03)

### Changes Made

Added status regression at export START in these endpoints:

1. **framing.py `/render`** (line ~695-710)
   - Main backend-authoritative framing export
   - Added `UPDATE projects SET final_video_id = NULL` in same transaction as export_jobs INSERT

2. **framing.py `/upscale`** (line ~211-223)
   - Legacy endpoint with direct video upload
   - Added same status regression

3. **multi_clip.py `/export`** (line ~656-668)
   - Multi-clip framing export
   - Added same status regression

### Endpoints NOT changed (intentionally)

- **framing.py `/framing`** - Receives already-rendered video from frontend, regression at save time is appropriate
- **overlay.py endpoints** - Re-overlaying should keep "Complete" status until new final video is created

### How it works now

1. User starts re-framing a "Complete" project
2. Export job is created AND `final_video_id` is cleared in same transaction
3. Status immediately becomes "In Overlay" (no more `has_final_video`)
4. Project card shows "In Overlay" + "Exporting..." indicator
5. Export completes, `working_video_id` is updated
6. Status remains "In Overlay" until overlay export is done

## Current Architecture

### Project Status Flow
- `projects` table has status/state columns
- Project card reads from `projects` table
- Export completion updates project status forward
- **No logic to regress status on re-export**

### Relevant Tables
```sql
projects:
  - id
  - status (or similar state column)
  - final_video_id (points to working_videos)
  - overlay_video_id (or similar)

working_videos:
  - id
  - project_id
  - version
  - created_at

export_jobs:
  - id
  - project_id
  - type ('framing' | 'overlay')
  - status
```

## Proposed Solution

### 1. Regress Status on Export Start

When a new export starts, update project status to match the export type:

```python
# In multi_clip.py (framing export)
async def export_multi_clip(...):
    # When framing export starts, regress project status
    if project_id:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE projects
                SET status = 'framing',
                    final_video_id = NULL  -- Clear completed video reference
                WHERE id = ?
            """, (project_id,))
            conn.commit()
```

```python
# In overlay.py (overlay export)
async def export_overlay(...):
    # When overlay export starts, regress project status
    if project_id:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE projects
                SET status = 'overlay'
                    -- Keep working_video_id, clear final if exists
                WHERE id = ?
            """, (project_id,))
            conn.commit()
```

### 2. Track Active Exports Per Project

The project card should show export activity:

```python
# API endpoint for project details
def get_project(project_id):
    # Include active exports in response
    active_exports = get_active_exports_for_project(project_id)
    return {
        ...project_data,
        'active_exports': active_exports,
        'is_exporting': len(active_exports) > 0
    }
```

### 3. Frontend Project Card Updates

```javascript
// ProjectCard.jsx
function ProjectCard({ project }) {
    const activeExports = project.active_exports || [];
    const isExporting = activeExports.length > 0;

    // Show export indicator if any exports are active
    if (isExporting) {
        return <ExportingIndicator exports={activeExports} />;
    }

    // Show status based on actual state
    return <StatusBadge status={project.status} />;
}
```

### 4. Status Calculation Logic

Define clear status hierarchy:

```python
def calculate_project_status(project_id):
    """
    Calculate project status based on actual state.

    Priority:
    1. Active export -> 'exporting_framing' or 'exporting_overlay'
    2. Has final video -> 'complete'
    3. Has working video -> 'framed' (ready for overlay)
    4. Has clips with framing data -> 'in_progress'
    5. Has clips without framing -> 'not_started'
    """
    active_exports = get_active_exports(project_id)
    if active_exports:
        export_type = active_exports[0]['type']
        return f'exporting_{export_type}'

    project = get_project(project_id)
    if project.final_video_id:
        return 'complete'
    if project.working_video_id:
        return 'framed'

    clips = get_project_clips(project_id)
    if any(clip.crop_data for clip in clips):
        return 'in_progress'

    return 'not_started'
```

## Files to Modify

- `src/backend/app/routers/export/multi_clip.py` - Regress status on framing start
- `src/backend/app/routers/export/overlay.py` - Regress status on overlay start
- `src/backend/app/routers/projects.py` - Include active exports in response
- `src/frontend/src/components/ProjectManager.jsx` - Show export activity on cards

## Edge Cases

1. **Concurrent exports**: If user starts overlay while framing is running, which status wins?
   - Solution: Show the "earlier" step (framing takes precedence)

2. **Export failure**: If re-frame fails, should status go back to "complete"?
   - Solution: Only update status on export SUCCESS, not on start

3. **Page refresh during export**: Status should persist and show correctly
   - Solution: Calculate status from DB state, not just frontend

## Success Criteria

- [x] Re-framing a completed project shows "In Overlay" status (regressed from Complete)
- [ ] Project card shows export progress indicator during exports (already works via exportStore)
- [x] After export completes, status updates to new state (already worked)
- [ ] Page refresh shows correct status during export (needs testing)

Note: "Re-overlaying shows Overlay status" is N/A - overlay export keeps "Complete" status until new final video is created, which is correct behavior.

## Testing Notes

To test the status regression:
1. Complete a full export (framing → overlay) so project shows "Complete"
2. Go back to Framing screen and re-export
3. Navigate to Projects screen during export
4. Verify project shows "In Overlay" (not "Complete") with "Exporting..." indicator
5. Refresh page and verify status is still "In Overlay"

---

## Additional Issues Found During Testing (2026-02-03)

### Issue 1: Overlay segment still shows green during re-frame - FIXED

**Screenshot**: reframe.png - "Turn Drive Pass" shows "Exporting..." but Overlay segment is green

**Root Cause**: The UPDATE and INSERT were in the same transaction. When INSERT failed (UNIQUE constraint), the UPDATE was rolled back too.

**Fix Applied**: Separated the UPDATE (status regression) from the INSERT (export_jobs) into two independent transactions. The UPDATE now always succeeds even if INSERT fails.

Files modified:
- `framing.py` `/render` endpoint (line ~699-720)
- `framing.py` `/upscale` endpoint (line ~212-232)
- `multi_clip.py` (line ~656-680)

### Issue 2: CIP shows "1/2 exported" - confusing display

**Screenshot**: cip.png - "Class Interception Pass" shows 2 clips with first green, second blue

**Analysis**: This is actually CORRECT behavior:
- `clips_exported = 1` (first clip was exported previously)
- `clips_in_progress = 1` (second clip has edits but not exported)

This happens when a clip is added to a project after the initial export. The display is technically accurate but confusing to users.

**Possible fix**: When clips are added, clear `exported_at` on all clips to force re-export of entire project. Or show a warning that re-export is needed.

### Issue 3: Legend only shows 3 statuses, but cards show more - FIXED

**Screenshot**: many_cards.png - Legend shows "In Progress" and "Not Started" but cards have green and light blue segments

**Root Cause**: `getProjectStatusCounts()` only tracks 3 coarse statuses:
- `done` (has_final_video)
- `inProgress` (has any edits or working video)
- `notStarted` (nothing)

But project cards show 6 granular statuses in progress strips.

**Fix Applied**: Expanded status tracking to 4 categories that match what users see:
1. `done` (green) - has_final_video
2. `inOverlay` (light blue) - has_working_video but not has_final_video
3. `inProgress` (dark blue) - editing/exported but no working video
4. `notStarted` (gray) - nothing started

Files modified:
- `src/frontend/src/components/ProjectManager.jsx` - getProjectStatusCounts() now returns 4 statuses
- `src/frontend/src/components/shared/CollapsibleGroup.jsx` - legend and header show all 4 statuses with correct colors (bg-blue-300 for In Overlay to match project cards)
