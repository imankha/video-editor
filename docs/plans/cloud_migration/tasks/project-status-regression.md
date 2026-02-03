# Project Status Regression on Backward Steps

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

- [ ] Re-framing a completed project shows "Framing" status
- [ ] Re-overlaying shows "Overlay" status
- [ ] Project card shows export progress indicator during exports
- [ ] After export completes, status updates to new state
- [ ] Page refresh shows correct status during export
