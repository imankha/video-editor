# Video Editor - Persistence & Project Flow Implementation

This folder contains implementation prompts for adding persistence and a project-based workflow to the video editor.

## How to Use

1. **Read PREAMBLE.md first** - Contains project context that should be included with each task
2. **Execute tasks in order** - Each task builds on previous ones
3. **Test after each task** - Follow the testing steps to verify before moving on
4. **Copy both files to AI** - Paste PREAMBLE.md content, then the task content

## Task List

| # | File | Description | Est. Effort |
|---|------|-------------|-------------|
| 01 | TASK_01_database_setup.md | Create SQLite database layer | Small |
| 02 | TASK_02_project_api.md | Project CRUD endpoints | Medium |
| 03 | TASK_03_clips_api.md | Raw clips and working clips endpoints | Medium |
| 04 | TASK_04_frontend_project_state.md | React hooks for project state | Medium |
| 05 | TASK_05_frontend_project_ui.md | ProjectManager and NewProjectModal | Medium |
| 06 | TASK_06_app_refactor.md | App.jsx project-based flow | Large |
| 07 | TASK_07_annotate_export_update.md | Backend: Save clips, create projects | Large |
| 08 | TASK_08_frontend_annotate_integration.md | Frontend: Annotate export flow | Medium |
| 09 | TASK_09_clip_sidebar_library.md | Add clips from library UI | Medium |
| 10 | TASK_10_navigation_changes.md | FileUpload and ModeSwitcher updates | Medium |
| 11 | TASK_11_framing_export_update.md | Create working_video on export | Medium |
| 12 | TASK_12_overlay_export_update.md | Create final_video on export | Small |

## Dependency Graph

```
TASK_01 (Database)
    ↓
TASK_02 (Project API)
    ↓
TASK_03 (Clips API)
    ↓
TASK_04 (Frontend Hooks)
    ↓
TASK_05 (Project UI)
    ↓
TASK_06 (App Refactor) ←── TASK_10 (Navigation)
    ↓
TASK_07 (Annotate Export Backend)
    ↓
TASK_08 (Annotate Export Frontend)
    ↓
TASK_09 (Clip Library)
    ↓
TASK_11 (Framing Export)
    ↓
TASK_12 (Overlay Export)
```

## Database Schema Summary

```sql
raw_clips        -- From Annotate export (4+ star clips)
projects         -- Project definitions with aspect ratio
working_clips    -- Clips assigned to projects
working_videos   -- Videos from Framing export
final_videos     -- Videos from Overlay export
```

## Key Flows

### New User Flow
1. User opens app → sees Project Manager
2. Can create empty project OR click Annotate
3. Annotate → export creates projects automatically
4. Select project → Framing mode
5. Export → creates working_video, enables Overlay
6. Overlay → export creates final_video (100% complete)

### Export from Annotate Creates:
- Raw clips saved to `user_data/a/raw_clips/`
- 1 "game" project with all 4+ star clips (16:9)
- 1 project per 5-star clip (9:16)
- 2 download files (annotated full, clips compilation)

### Progress Calculation
```
total = clip_count + 1
progress = clips_framed + (1 if has_final_video else 0)
percent = (progress / total) * 100
```

## File Storage Structure

```
user_data/
└── a/
    ├── database.sqlite
    ├── raw_clips/       ← From Annotate export
    ├── uploads/         ← Direct uploads to projects
    ├── working_videos/  ← From Framing export
    └── final_videos/    ← From Overlay export
```

## Quick Test Commands

```bash
# Health check
curl http://localhost:8000/api/health

# List projects
curl http://localhost:8000/api/projects

# Create project
curl -X POST http://localhost:8000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Test", "aspect_ratio": "16:9"}'

# List raw clips
curl http://localhost:8000/api/clips/raw

# Check database
sqlite3 user_data/a/database.sqlite ".tables"
sqlite3 user_data/a/database.sqlite "SELECT * FROM projects;"
```

## Notes

- Database auto-creates on backend startup
- All video files stored on filesystem, not in database
- "abandoned" flag used for soft-delete on re-export
- Frontend refreshes project state after exports
- Aspect ratio set at project creation, not changeable in Framing
