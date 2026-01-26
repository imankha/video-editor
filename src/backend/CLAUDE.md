# Backend Guidelines

## Stack
FastAPI + Python 3.11 + SQLite + Cloudflare R2

## Testing
```bash
pytest tests/ -v                    # All tests
pytest tests/test_clips.py -v       # Specific file
pytest tests/ -k "test_name" -v     # By name
```

## Patterns

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
Use helpers from `app/queries.py`:
```python
from app.queries import latest_working_clips_subquery
cursor.execute(f"SELECT * FROM working_clips WHERE id IN ({latest_working_clips_subquery()})", (project_id,))
```

### Pydantic Models
Define in routers near endpoints. Use `Optional[T] = None` for nullable fields.

## Don't
- Don't use raw SQL without parameterization
- Don't store secrets in code (use env vars)
- Don't skip R2 upload for user files
