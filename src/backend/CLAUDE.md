# Backend Guidelines

## Stack
FastAPI + Python 3.11 + SQLite + Cloudflare R2

## Testing
```bash
.venv/Scripts/python.exe run_tests.py    # All tests (use this, not pytest directly)
pytest tests/test_clips.py -v             # Specific file
pytest tests/ -k "test_name" -v           # By name
```

## After Code Changes (REQUIRED)
**Always run this after editing Python files to catch errors before the user starts the server:**
```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
```
This catches import errors, undefined names, and syntax errors immediately.

---

## Skills

This codebase uses structured skills with prioritized rules. Each skill has a SKILL.md and individual rule files.

**Location:** `.claude/skills/`

| Skill | Priority | Description |
|-------|----------|-------------|
| [api-guidelines](/.claude/skills/api-guidelines/SKILL.md) | CRITICAL | R2 storage, parameterized queries |
| [persistence-model](/.claude/skills/persistence-model/SKILL.md) | CRITICAL | SQLite + R2 sync, version tracking |
| [database-schema](/.claude/skills/database-schema/SKILL.md) | HIGH | Version identity, latest queries, FK cascades |
| [gesture-based-sync](/.claude/skills/gesture-based-sync/SKILL.md) | HIGH | Action-based API instead of full blobs |

---

## Quick Reference

### File Paths
```python
from app.database import RAW_CLIPS_PATH, WORKING_VIDEOS_PATH
file_path = RAW_CLIPS_PATH / filename  # Use Path objects, not f-strings
```

### R2 Storage (always enabled)
```python
from app.services.r2_storage import upload_to_r2, generate_presigned_url
await upload_to_r2(user_id, r2_key, local_path)
url = generate_presigned_url(user_id, r2_key)
```

### Modal GPU (when MODAL_ENABLED=true)
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

### Pydantic Models
Define in routers near endpoints. Use `Optional[T] = None` for nullable fields.

---

## Gesture-Based Sync (Preferred)

Send actions instead of full state blobs:
```python
# Instead of PUT with full data
POST /api/clips/{id}/actions
{
  "action": "add_crop_keyframe",
  "data": { "frame": 100, "x": 50, "y": 50 }
}
```

See [gesture-based-sync skill](/.claude/skills/gesture-based-sync/SKILL.md) for full documentation.

---

## Don't
- Don't use raw SQL without parameterization
- Don't store secrets in code (use env vars)
- Don't skip R2 upload for user files
- Don't send full state blobs (use gesture-based actions)
