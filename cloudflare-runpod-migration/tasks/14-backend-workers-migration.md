# Task 14: Backend Workers Migration

## Overview
Update the FastAPI backend to optionally route export requests to Cloudflare Workers instead of processing locally.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 13 complete (Durable Objects working)
- Local backend still running (for fallback)

## Testability
**After this task**: Backend can switch between local processing and Workers with a config flag.

---

## Migration Strategy

We'll use a **feature flag** approach:
1. Add `USE_WORKERS_EXPORT=true` config
2. When true, backend forwards export requests to Workers
3. When false, uses existing local processing
4. Allows gradual rollout and easy rollback

---

## Files to Modify

### .env

```bash
# Add Workers configuration
USE_WORKERS_EXPORT=false  # Set to true when ready
WORKERS_API_URL=https://reel-ballers-api.your-subdomain.workers.dev
```

### services/workers_client.py (NEW)

```python
"""
Client for communicating with Cloudflare Workers API.
"""

import httpx
import os
from typing import Dict, Any, Optional

WORKERS_API_URL = os.getenv("WORKERS_API_URL", "http://localhost:8787")
USE_WORKERS_EXPORT = os.getenv("USE_WORKERS_EXPORT", "false").lower() == "true"


class WorkersClient:
    def __init__(self, user_id: str):
        self.base_url = WORKERS_API_URL
        self.user_id = user_id
        self.headers = {
            "Content-Type": "application/json",
            "X-User-Id": user_id,
        }

    async def start_export(
        self,
        export_type: str,
        project_id: int,
        input_key: str,
        params: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Start an export job via Workers.

        Returns:
            {"job_id": "uuid", "status": "processing"}
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/api/export/{export_type}/start",
                headers=self.headers,
                json={
                    "project_id": project_id,
                    "input_key": input_key,
                    "params": params,
                },
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def get_job_status(self, job_id: str) -> Dict[str, Any]:
        """
        Get status of an export job.

        Returns:
            {"job_id": "...", "status": "...", "progress": N, "output_key": "..."}
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/api/export/status/{job_id}",
                headers=self.headers,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()

    def get_websocket_url(self, job_id: str) -> str:
        """Get WebSocket URL for job updates."""
        ws_base = self.base_url.replace("http://", "ws://").replace("https://", "wss://")
        return f"{ws_base}/api/jobs/{job_id}/ws"
```

### Modified routers/export/overlay.py

```python
from services.workers_client import WorkersClient, USE_WORKERS_EXPORT
from app.user_context import get_current_user_id

@router.post("/overlay/start")
async def start_overlay_export(request: OverlayExportRequest):
    """Start an overlay export job."""
    user_id = get_current_user_id()

    if USE_WORKERS_EXPORT:
        # Route to Workers
        return await start_overlay_export_workers(request, user_id)
    else:
        # Use existing local/RunPod processing
        return await start_overlay_export_local(request, user_id)


async def start_overlay_export_workers(request: OverlayExportRequest, user_id: str):
    """Start overlay export via Cloudflare Workers."""
    client = WorkersClient(user_id)

    # Get input key from database
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT filename FROM working_videos
            WHERE project_id = ? ORDER BY version DESC LIMIT 1
        """, (request.project_id,))
        result = cursor.fetchone()

        if not result:
            raise HTTPException(status_code=400, detail="No working video found")

        input_key = f"working_videos/{result['filename']}"

    # Submit to Workers
    result = await client.start_export(
        export_type="overlay",
        project_id=request.project_id,
        input_key=input_key,
        params={
            "highlight_regions": [r.dict() for r in request.highlight_regions],
            "effect_type": request.effect_type,
        }
    )

    return {
        "job_id": result["job_id"],
        "status": result["status"],
        "websocket_url": client.get_websocket_url(result["job_id"]),
    }


async def start_overlay_export_local(request: OverlayExportRequest, user_id: str):
    """Existing local export logic (from Task 08)."""
    # ... existing RunPod submission code ...
    pass


@router.get("/overlay/status/{job_id}")
async def get_overlay_status(job_id: str):
    """Get status of an overlay export job."""
    user_id = get_current_user_id()

    if USE_WORKERS_EXPORT:
        client = WorkersClient(user_id)
        return await client.get_job_status(job_id)
    else:
        # Existing status logic
        pass
```

---

## Dual Mode Operation

During migration, both paths work:

```
Frontend
   │
   ├─── POST /api/export/overlay/start ───► FastAPI Backend
   │                                              │
   │                                    USE_WORKERS_EXPORT?
   │                                       /         \
   │                                     Yes          No
   │                                      │           │
   │                                      ▼           ▼
   │                              Workers API    Local RunPod
   │                                      │           │
   └─────────────────────────────────────┴───────────┘
```

---

## Testing the Migration

### Step 1: Test with Workers disabled

```bash
# .env
USE_WORKERS_EXPORT=false

# Run backend
uvicorn app.main:app --reload

# Test export - should use existing RunPod path
```

### Step 2: Test with Workers enabled

```bash
# .env
USE_WORKERS_EXPORT=true
WORKERS_API_URL=http://localhost:8787

# Run Workers locally
cd workers && npm run dev

# Run backend
uvicorn app.main:app --reload

# Test export - should route to Workers
```

### Step 3: Deploy and switch

```bash
# Deploy Workers
cd workers && wrangler deploy

# Update .env
WORKERS_API_URL=https://reel-ballers-api.your-subdomain.workers.dev

# Restart backend
# Test in production
```

---

## Rollback Plan

If Workers has issues:

1. Set `USE_WORKERS_EXPORT=false` in .env
2. Restart backend
3. All exports use local/RunPod path again

---

## API Response Changes

The response now includes a `websocket_url` for real-time updates:

### Before
```json
{
  "job_id": "abc-123",
  "status": "processing"
}
```

### After
```json
{
  "job_id": "abc-123",
  "status": "processing",
  "websocket_url": "wss://reel-ballers-api.workers.dev/api/jobs/abc-123/ws"
}
```

Frontend can optionally connect to WebSocket for real-time progress.

---

## Handoff Notes

**For Task 15 (Frontend Updates):**
- Backend returns `websocket_url` in export response
- Frontend should connect to WebSocket for progress
- Fall back to polling if WebSocket not available
- Same API shape works for both local and Workers modes
