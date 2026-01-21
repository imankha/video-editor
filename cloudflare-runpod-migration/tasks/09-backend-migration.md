# Task 09: Backend Migration

## Overview
Update the FastAPI backend to submit export jobs to Cloudflare Workers instead of processing locally.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 06 complete (Workers API routes working)
- Task 08 complete (GPU worker deployed)

## Time Estimate
1-2 hours

---

## Migration Strategy

The backend changes are minimal. Instead of processing videos locally, we:
1. Upload input video to R2
2. Submit job to Cloudflare Workers API
3. Return job ID to frontend
4. Let Workers + RunPod handle the rest

---

## Files to Modify

| File | Changes |
|------|---------|
| `routers/exports.py` | Replace local processing with API calls |
| `routers/export/overlay.py` | Simplify to job submission |
| `routers/export/framing.py` | Simplify to job submission |
| `services/export_worker.py` | Can be deleted after migration |
| `config.py` | Add Workers URL configuration |

---

## New Configuration

### config.py additions

```python
# Add to existing config

# Cloudflare Workers
WORKERS_API_URL = os.getenv("WORKERS_API_URL", "http://localhost:8787")
WORKERS_API_KEY = os.getenv("WORKERS_API_KEY", "")  # Optional auth

# R2 Configuration (for direct uploads)
R2_ENDPOINT = os.getenv("R2_ENDPOINT", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME", "reel-ballers-videos")
```

---

## New Service: Workers Client

### services/workers_client.py

```python
"""
Client for communicating with Cloudflare Workers API
"""

import httpx
from typing import Optional, Dict, Any
from app.config import WORKERS_API_URL, WORKERS_API_KEY


class WorkersClient:
    def __init__(self):
        self.base_url = WORKERS_API_URL.rstrip("/")
        self.headers = {
            "Content-Type": "application/json",
        }
        if WORKERS_API_KEY:
            self.headers["Authorization"] = f"Bearer {WORKERS_API_KEY}"

    async def create_job(
        self,
        project_id: int,
        job_type: str,
        input_video_key: str,
        params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Create a new export job.

        Returns:
            {
                "job_id": "uuid",
                "status": "pending",
                "websocket_url": "/api/jobs/{id}/ws"
            }
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/api/jobs",
                headers=self.headers,
                json={
                    "project_id": project_id,
                    "type": job_type,
                    "input_video_key": input_video_key,
                    "params": params
                },
                timeout=30.0
            )
            response.raise_for_status()
            return response.json()

    async def get_job(self, job_id: str) -> Dict[str, Any]:
        """Get job status"""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/api/jobs/{job_id}",
                headers=self.headers,
                timeout=10.0
            )
            response.raise_for_status()
            return response.json()

    async def get_upload_url(self, filename: str, job_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Get presigned URL for uploading video to R2.

        Returns:
            {
                "upload_url": "https://...",
                "video_key": "input/{job_id}/video.mp4"
            }
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/api/videos/upload-url",
                headers=self.headers,
                json={
                    "filename": filename,
                    "content_type": "video/mp4",
                    "job_id": job_id
                },
                timeout=10.0
            )
            response.raise_for_status()
            return response.json()


# Singleton instance
workers_client = WorkersClient()
```

---

## New Service: R2 Client

### services/r2_client.py

```python
"""
R2 Storage Client for direct uploads from backend
"""

import boto3
from botocore.config import Config
from app.config import R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME


class R2Client:
    def __init__(self):
        self.bucket_name = R2_BUCKET_NAME
        self.client = None

        if R2_ENDPOINT and R2_ACCESS_KEY_ID:
            self.client = boto3.client(
                "s3",
                endpoint_url=R2_ENDPOINT,
                aws_access_key_id=R2_ACCESS_KEY_ID,
                aws_secret_access_key=R2_SECRET_ACCESS_KEY,
                config=Config(signature_version="s3v4"),
                region_name="auto"
            )

    def upload_file(self, local_path: str, key: str, content_type: str = "video/mp4"):
        """Upload a local file to R2"""
        if not self.client:
            raise RuntimeError("R2 client not configured")

        self.client.upload_file(
            local_path,
            self.bucket_name,
            key,
            ExtraArgs={"ContentType": content_type}
        )
        return key

    def upload_bytes(self, data: bytes, key: str, content_type: str = "video/mp4"):
        """Upload bytes directly to R2"""
        if not self.client:
            raise RuntimeError("R2 client not configured")

        self.client.put_object(
            Bucket=self.bucket_name,
            Key=key,
            Body=data,
            ContentType=content_type
        )
        return key


# Singleton instance
r2_client = R2Client()
```

---

## Modified Export Router

### routers/export/overlay.py (Updated)

```python
"""
Overlay Export Router - Submits jobs to Cloudflare Workers
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional
import uuid
import os

from app.services.workers_client import workers_client
from app.services.r2_client import r2_client
from app.database import get_db

router = APIRouter()


class HighlightRegion(BaseModel):
    start_frame: int
    end_frame: int
    x: float
    y: float
    radius_x: float
    radius_y: float
    opacity: float = 1.0
    color: str = "#ffffff"


class CropKeyframe(BaseModel):
    frame: int
    x: float
    y: float
    width: float
    height: float


class OverlayExportRequest(BaseModel):
    project_id: int
    highlight_regions: List[HighlightRegion] = []
    effect_type: str = "blur"
    crop_keyframes: Optional[List[CropKeyframe]] = None
    output_width: int = 1080
    output_height: int = 1920


class OverlayExportResponse(BaseModel):
    job_id: str
    status: str
    websocket_url: str


@router.post("/overlay", response_model=OverlayExportResponse)
async def start_overlay_export(request: OverlayExportRequest):
    """
    Start an overlay export job.

    1. Find the working video for the project
    2. Upload it to R2
    3. Submit job to Cloudflare Workers
    4. Return job ID for status tracking
    """
    # Get project's working video path
    db = get_db()
    project = db.execute(
        "SELECT * FROM projects WHERE id = ?",
        (request.project_id,)
    ).fetchone()

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    working_video_path = project["working_video_path"]
    if not working_video_path or not os.path.exists(working_video_path):
        raise HTTPException(status_code=400, detail="No working video found")

    # Generate job ID
    job_id = str(uuid.uuid4())

    # Upload working video to R2
    input_key = f"input/{job_id}/working_video.mp4"
    try:
        r2_client.upload_file(working_video_path, input_key)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload video: {e}")

    # Submit job to Workers
    try:
        result = await workers_client.create_job(
            project_id=request.project_id,
            job_type="overlay",
            input_video_key=input_key,
            params={
                "highlight_regions": [r.dict() for r in request.highlight_regions],
                "effect_type": request.effect_type,
                "crop_keyframes": [k.dict() for k in request.crop_keyframes] if request.crop_keyframes else None,
                "output_width": request.output_width,
                "output_height": request.output_height,
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create job: {e}")

    return OverlayExportResponse(
        job_id=result["job_id"],
        status=result["status"],
        websocket_url=result["websocket_url"]
    )


@router.get("/overlay/{job_id}")
async def get_overlay_export_status(job_id: str):
    """Get status of an overlay export job"""
    try:
        return await workers_client.get_job(job_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get job status: {e}")
```

---

## Framing Export (Similar Pattern)

### routers/export/framing.py (Updated)

```python
"""
Framing Export Router - Submits jobs to Cloudflare Workers
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
import uuid
import os

from app.services.workers_client import workers_client
from app.services.r2_client import r2_client
from app.database import get_db

router = APIRouter()


class CropKeyframe(BaseModel):
    frame: int
    x: float
    y: float
    width: float
    height: float


class FramingExportRequest(BaseModel):
    project_id: int
    clip_index: int
    crop_keyframes: List[CropKeyframe]
    output_width: int = 1080
    output_height: int = 1920


@router.post("/framing")
async def start_framing_export(request: FramingExportRequest):
    """Start a framing export job for a single clip"""
    db = get_db()

    # Get clip info
    clip = db.execute("""
        SELECT wc.*, rc.video_path as source_path
        FROM working_clips wc
        JOIN raw_clips rc ON wc.raw_clip_id = rc.id
        WHERE wc.project_id = ? AND wc.clip_index = ?
    """, (request.project_id, request.clip_index)).fetchone()

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    source_path = clip["source_path"]
    if not source_path or not os.path.exists(source_path):
        raise HTTPException(status_code=400, detail="Source video not found")

    # Generate job ID
    job_id = str(uuid.uuid4())

    # Upload source clip to R2
    input_key = f"input/{job_id}/source.mp4"
    r2_client.upload_file(source_path, input_key)

    # Submit job
    result = await workers_client.create_job(
        project_id=request.project_id,
        job_type="framing",
        input_video_key=input_key,
        params={
            "clip_index": request.clip_index,
            "crop_keyframes": [k.dict() for k in request.crop_keyframes],
            "output_width": request.output_width,
            "output_height": request.output_height,
            "start_time": clip["start_time"],
            "end_time": clip["end_time"],
        }
    )

    return result
```

---

## WebSocket Proxy (Optional)

If you want the frontend to continue using the existing WebSocket endpoint:

### routers/websocket.py (Updated)

```python
"""
WebSocket proxy to Cloudflare Workers
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import httpx
import asyncio

from app.config import WORKERS_API_URL

router = APIRouter()


@router.websocket("/ws/export/{job_id}")
async def export_websocket(websocket: WebSocket, job_id: str):
    """
    Proxy WebSocket connection to Cloudflare Workers.

    Frontend connects here, we forward to Workers Durable Object.
    """
    await websocket.accept()

    workers_ws_url = f"{WORKERS_API_URL.replace('http', 'ws')}/api/jobs/{job_id}/ws"

    try:
        async with httpx.AsyncClient() as client:
            # For simplicity, we'll poll instead of true WebSocket proxy
            # A full implementation would use websockets library

            while True:
                # Poll job status
                response = await client.get(
                    f"{WORKERS_API_URL}/api/jobs/{job_id}",
                    timeout=5.0
                )
                data = response.json()

                await websocket.send_json(data)

                if data.get("status") in ["complete", "error"]:
                    break

                await asyncio.sleep(1)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await websocket.send_json({"error": str(e)})
```

**Note**: For production, consider having the frontend connect directly to Workers WebSocket.

---

## Cleanup: Files to Delete

After migration is complete and tested:

```
src/backend/app/
├── services/
│   └── export_worker.py      # DELETE - no longer needed
├── routers/export/
│   └── old_overlay.py        # DELETE - replaced with new version
```

---

## Environment Variables

Add to `.env` or deployment config:

```bash
# Cloudflare Workers
WORKERS_API_URL=https://reel-ballers-api.your-subdomain.workers.dev
WORKERS_API_KEY=optional-auth-key

# R2 Storage
R2_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=reel-ballers-videos
```

---

## Handoff Notes

**For Task 10 (Frontend Migration):**
- Backend API shape is mostly unchanged
- New fields in response: `job_id`, `websocket_url`
- Can connect to Workers WebSocket directly for real-time updates

**For Task 11 (Testing):**
- Test job submission flow
- Verify R2 uploads work
- Check WebSocket updates arrive

---

## Rollback Plan

If issues occur, the old local processing can be re-enabled by:
1. Restoring `export_worker.py`
2. Changing router to call local processing instead of Workers
3. No data migration needed (jobs are independent)
