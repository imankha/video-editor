# sync-r2-always

**Priority:** CRITICAL
**Category:** Sync Rules

## Rule
All user data must sync to R2. Local SQLite is a cache, not the source of truth.

## Rationale
R2 provides:
1. **Durability**: Data survives server restarts/redeployment
2. **Cross-device access**: User can access from any device
3. **Backup**: R2 has built-in redundancy
4. **CDN integration**: Fast global access via presigned URLs

## Implementation

```python
# In middleware/db_sync.py
class DatabaseSyncMiddleware:
    async def dispatch(self, request, call_next):
        # Before request: sync from R2 if newer
        await sync_database_from_r2_if_newer(user_id)

        response = await call_next(request)

        # After request: sync to R2 if writes occurred
        if request_context.has_writes:
            await sync_database_to_r2_with_version(user_id)

        return response
```

## Version-Based Sync

```python
def sync_database_from_r2_if_newer(user_id: str):
    r2_version = get_db_version_from_r2(user_id)  # From x-amz-meta-db-version
    local_version = get_local_db_version(user_id)

    if r2_version > local_version:
        download_db_from_r2(user_id)
        set_local_db_version(user_id, r2_version)
```

## Incorrect Example

```python
# BAD: Writing to local only
@router.post("/projects")
async def create_project(data: ProjectCreate, user_id: str):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO projects...", (...))
        conn.commit()
    return {"id": cursor.lastrowid}
    # No R2 sync! Data lost on server restart
```

## Correct Example

```python
# GOOD: Middleware handles R2 sync automatically
@router.post("/projects")
async def create_project(data: ProjectCreate, user_id: str):
    with get_db_connection() as conn:  # TrackedConnection
        cursor = conn.cursor()
        cursor.execute("INSERT INTO projects...", (...))
        conn.commit()
        # TrackedConnection marks this as a write
    return {"id": cursor.lastrowid}
    # Middleware syncs to R2 after response
```

## Testing

1. Create data in app
2. Stop server, delete local database
3. Restart server
4. Data should reload from R2

## Additional Context

The middleware handles sync automatically. Developers don't need to call sync functions manually—just use `get_db_connection()` and the system handles the rest.
