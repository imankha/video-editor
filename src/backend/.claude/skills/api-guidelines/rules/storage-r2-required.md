# storage-r2-required

**Priority:** CRITICAL
**Category:** Storage Patterns

## Rule
All user files must be uploaded to R2 storage. Local storage is only for temporary processing.

## Rationale
The app uses Cloudflare R2 as the single source of truth for user data:
1. Enables access across devices
2. Provides durability and backup
3. Enables CDN delivery via presigned URLs
4. Local files may be cleared during updates

## Incorrect Example

```python
@router.post("/upload")
async def upload_video(file: UploadFile, user_id: str):
    # BAD: Only storing locally
    local_path = WORKING_VIDEOS_PATH / user_id / file.filename

    async with aiofiles.open(local_path, 'wb') as f:
        content = await file.read()
        await f.write(content)

    return {"path": str(local_path)}  # Returns local path
```

**Why this is wrong:**
- File only exists locally
- User can't access from another device
- File may be lost if server restarts
- No durability guarantees

## Correct Example

```python
from app.services.r2_storage import upload_to_r2, generate_presigned_url

@router.post("/upload")
async def upload_video(file: UploadFile, user_id: str):
    # Save locally first (for processing)
    local_path = WORKING_VIDEOS_PATH / user_id / file.filename
    local_path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(local_path, 'wb') as f:
        content = await file.read()
        await f.write(content)

    # GOOD: Upload to R2
    r2_key = f"videos/{file.filename}"
    await upload_to_r2(user_id, r2_key, local_path)

    # Return presigned URL for client access
    url = generate_presigned_url(user_id, r2_key)
    return {"url": url, "r2_key": r2_key}
```

## Additional Context

### R2 Key Structure
```
{user_id}/
  database.sqlite          # User database
  videos/
    {filename}             # Uploaded videos
  exports/
    {export_id}/
      output.mp4           # Exported files
```

### When to Use Local Storage
- Temporary processing files (delete after use)
- Cache files (can be regenerated)
- Work-in-progress before final upload

### Upload Timing
- Upload to R2 after successful processing
- Don't upload partial or failed results
- Use progress callbacks for long uploads
