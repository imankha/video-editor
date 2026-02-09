# Backend Guidelines

> Full implementation guidelines: [../../.claude/workflows/2-implementation.md](../../.claude/workflows/2-implementation.md)

## Virtual Environment

```bash
# Run commands directly (Windows)
cd src/backend && .venv/Scripts/python.exe <script.py>
cd src/backend && .venv/Scripts/pip.exe install <package>
```

## After Code Changes (REQUIRED)

**Always run this after editing Python files:**
```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
```

## Skills

| Skill | Priority | Description |
|-------|----------|-------------|
| [api-guidelines](.claude/skills/api-guidelines/SKILL.md) | CRITICAL | R2 storage, parameterized queries |
| [persistence-model](.claude/skills/persistence-model/SKILL.md) | CRITICAL | SQLite + R2 sync, version tracking |
| [bug-reproduction](.claude/skills/bug-reproduction/SKILL.md) | CRITICAL | Test-first bug fixing |
| [type-safety](.claude/skills/type-safety/SKILL.md) | HIGH | Use `str, Enum` classes, no magic strings |
| [database-schema](.claude/skills/database-schema/SKILL.md) | HIGH | Version identity, latest queries, FK cascades |
| [gesture-based-sync](.claude/skills/gesture-based-sync/SKILL.md) | HIGH | Action-based API instead of full blobs |
| [lint](.claude/skills/lint/SKILL.md) | MEDIUM | Import check + mypy |

## Quick Reference

### File Paths
```python
from app.database import RAW_CLIPS_PATH, WORKING_VIDEOS_PATH
file_path = RAW_CLIPS_PATH / filename
```

### R2 Storage
```python
from app.services.r2_storage import upload_to_r2, generate_presigned_url
await upload_to_r2(user_id, r2_key, local_path)
url = generate_presigned_url(user_id, r2_key)
```

### Modal GPU (Unified Interface)
```python
from app.services.modal_client import call_modal_framing_ai
# Always call unified interface - routes internally
result = await call_modal_framing_ai(job_id, user_id, ...)
```

### Export Helpers
```python
from app.services.export_helpers import (
    create_export_job, complete_export_job, fail_export_job,
    send_progress, create_progress_callback
)
```

### Version-based Queries
```python
from app.queries import latest_working_clips_subquery
cursor.execute(
    f"SELECT * FROM working_clips WHERE id IN ({latest_working_clips_subquery()})",
    (project_id,)
)
```

## Don't
- Don't use raw SQL without parameterization
- Don't store secrets in code (use env vars)
- Don't skip R2 upload for user files
- Don't send full state blobs (use gesture-based actions)
- Don't add print() statements in committed code
