---
name: api-guidelines
description: "FastAPI backend patterns and best practices. Apply when creating endpoints, handling data persistence, working with R2 storage, or Modal GPU processing."
license: MIT
author: video-editor
version: 1.0.0
---

# API Guidelines

FastAPI backend patterns for the video editor. Covers endpoint design, storage patterns, and GPU processing.

## When to Apply
- Creating new API endpoints
- Working with file storage (R2)
- Implementing Modal GPU processing
- Writing database queries
- Handling user data persistence

## Rule Categories

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Storage Patterns | CRITICAL | `storage-` |
| 2 | Query Patterns | HIGH | `query-` |
| 3 | Endpoint Design | MEDIUM | `endpoint-` |
| 4 | Error Handling | MEDIUM | `error-` |

## Quick Reference

### Storage Patterns (CRITICAL)
- `storage-r2-required` - All user files must be uploaded to R2
- `storage-path-objects` - Use Path objects, not f-strings for file paths
- `storage-presigned-urls` - Generate presigned URLs for client access

### Query Patterns (HIGH)
- `query-parameterized` - Always use parameterized queries
- `query-version-helpers` - Use query helpers for versioned data
- `query-user-context` - Always scope queries to user_id

### Endpoint Design (MEDIUM)
- `endpoint-pydantic` - Define Pydantic models near endpoints
- `endpoint-optional-fields` - Use `Optional[T] = None` for nullable
- `endpoint-progress-websocket` - Use WebSocket for long operations

### Error Handling (MEDIUM)
- `error-import-check` - Run import check after code changes
- `error-logging` - Use structured logging with timestamps
- `error-traceback` - Include full traceback in error responses

---

## Critical Patterns

### After Code Changes (REQUIRED)
Always run this after editing Python files:
```bash
cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"
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

### Versioned Queries
```python
from app.queries import latest_working_clips_subquery

cursor.execute(
    f"SELECT * FROM working_clips WHERE id IN ({latest_working_clips_subquery()})",
    (project_id,)
)
```

---

## Complete Rules

See individual rule files in `rules/` directory.
