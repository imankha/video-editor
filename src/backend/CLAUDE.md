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

### Modal GPU
```python
from app.services.modal_client import call_modal_framing_ai, modal_enabled
if modal_enabled():
    result = await call_modal_framing_ai(..., progress_callback=callback)
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
