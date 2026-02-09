# Backend Guidelines

## Virtual Environment

The backend uses a Python virtual environment at `src/backend/.venv/`.

```bash
# Activate (Windows)
cd src/backend
.venv\Scripts\activate

# Or run commands directly without activating
.venv/Scripts/python.exe <script.py>
.venv/Scripts/pip.exe install <package>
```

## After Code Changes (REQUIRED)

**Always run this after editing Python files to catch errors before starting the server:**
```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
```
This catches import errors, undefined names, and syntax errors immediately.

---

## Skills

| Skill | Priority | Description |
|-------|----------|-------------|
| [api-guidelines](.claude/skills/api-guidelines/SKILL.md) | CRITICAL | R2 storage, parameterized queries |
| [persistence-model](.claude/skills/persistence-model/SKILL.md) | CRITICAL | SQLite + R2 sync, version tracking |
| [bug-reproduction](.claude/skills/bug-reproduction/SKILL.md) | CRITICAL | Test-first bug fixing: write failing test, fix, verify |
| [type-safety](.claude/skills/type-safety/SKILL.md) | HIGH | Use `str, Enum` classes, no magic strings |
| [database-schema](.claude/skills/database-schema/SKILL.md) | HIGH | Version identity, latest queries, FK cascades |
| [gesture-based-sync](.claude/skills/gesture-based-sync/SKILL.md) | HIGH | Action-based API instead of full blobs |
| [lint](.claude/skills/lint/SKILL.md) | MEDIUM | Import check + mypy for Python |

---

## Quick Reference

### File Paths
```python
from app.database import RAW_CLIPS_PATH, WORKING_VIDEOS_PATH
file_path = RAW_CLIPS_PATH / filename  # Use Path objects, not f-strings
```

### R2 Storage
```python
from app.services.r2_storage import upload_to_r2, generate_presigned_url
await upload_to_r2(user_id, r2_key, local_path)
url = generate_presigned_url(user_id, r2_key)
```

### Modal GPU (Unified Interface)

The `modal_client.py` functions automatically route to local fallbacks when `MODAL_ENABLED=false`.
This enables testing production code paths without Modal costs.

```python
from app.services.modal_client import call_modal_framing_ai, call_modal_overlay

# CORRECT: Always call the unified interface - it routes internally
result = await call_modal_framing_ai(job_id, user_id, input_key, output_key, ...)

# WRONG: Don't check modal_enabled() in routers
if modal_enabled():
    result = await call_modal_framing_ai(...)
else:
    # 100 lines of local processing...  <- This duplicates code!
```

**Architecture:**
- `modal_client.py` → unified interface, routes to Modal or local
- `local_processors.py` → local fallbacks with same interface as Modal
- Router endpoints → always call `call_modal_*()`, never branch on `modal_enabled()`

### Export Helpers

Shared utilities for all export types (annotate, framing, overlay):

```python
from app.services.export_helpers import (
    create_export_job,
    complete_export_job,
    fail_export_job,
    send_progress,
    create_progress_callback,
    derive_project_name,
)

# Create job tracking record
create_export_job(export_id, project_id, 'framing')

# Send progress via WebSocket
await send_progress(export_id, 50, 100, 'processing', 'Halfway done...', 'framing',
                    project_id=project_id, project_name=project_name)

# Create callback for Modal/local processors
progress_callback = create_progress_callback(export_id, 'framing', project_id, project_name)
result = await call_modal_framing_ai(..., progress_callback=progress_callback)

# Complete or fail
complete_export_job(export_id, output_filename)
fail_export_job(export_id, "Something went wrong")
```

### Version-based Queries
```python
from app.queries import latest_working_clips_subquery
cursor.execute(
    f"SELECT * FROM working_clips WHERE id IN ({latest_working_clips_subquery()})",
    (project_id,)
)
```

### Gesture-Based Sync
```python
# Send actions instead of full state blobs
POST /api/clips/{id}/actions
{
  "action": "add_crop_keyframe",
  "data": { "frame": 100, "x": 50, "y": 50 }
}
```

### Pydantic Models
Define in routers near endpoints. Use `Optional[T] = None` for nullable fields.

---

## Don't
- Don't use raw SQL without parameterization
- Don't store secrets in code (use env vars)
- Don't skip R2 upload for user files
- Don't send full state blobs (use gesture-based actions)
