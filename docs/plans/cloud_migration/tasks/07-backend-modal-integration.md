# Task 07: Backend Modal Integration

## Overview
Update the FastAPI backend to call Modal functions for GPU video processing instead of local FFmpeg.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 06 complete (Modal GPU functions deployed)
- R2 storage working (Tasks 01-04)

## Testability
**After this task**: Export buttons in the app trigger Modal GPU processing. Results appear in downloads.

---

## What Changes

| Before | After |
|--------|-------|
| Backend processes video locally | Backend calls Modal function |
| Blocking export (wait for result) | Async job with polling |
| Progress via local WebSocket | Progress via job status |
| Output saved to local filesystem | Output saved to R2 by Modal |

---

## Key Advantage: Direct Python Calls

Unlike RunPod (HTTP API + polling), Modal lets you call functions directly:

```python
# Simple! Just call .remote()
from modal_functions.video_processing import process_video

result = process_video.remote(
    job_id="abc",
    user_id="a",
    job_type="framing",
    input_key="working_videos/video.mp4",
    output_key="final_videos/export.mp4",
    params={"output_width": 1080}
)
# result = {"status": "success", "output_key": "..."}
```

---

## Files to Create/Modify

### New: services/modal_client.py

```python
"""
Client for calling Modal GPU functions.
"""
import os
import asyncio
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)

# Check if Modal is enabled
MODAL_ENABLED = os.getenv("MODAL_ENABLED", "false").lower() == "true"


async def process_video_modal(
    job_id: str,
    user_id: str,
    job_type: str,
    input_key: str,
    output_key: str,
    params: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Call Modal GPU function for video processing.

    Returns:
        {"status": "success", "output_key": "..."} or
        {"status": "error", "error": "..."}
    """
    if not MODAL_ENABLED:
        raise RuntimeError("Modal is not enabled. Set MODAL_ENABLED=true")

    # Import Modal function (lazy import to avoid issues when Modal not installed)
    from modal_functions.video_processing import process_video

    logger.info(f"[{job_id}] Submitting to Modal: {job_type}")

    # Modal functions are sync but we run in thread to not block
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: process_video.remote(
            job_id=job_id,
            user_id=user_id,
            job_type=job_type,
            input_key=input_key,
            output_key=output_key,
            params=params,
        )
    )

    logger.info(f"[{job_id}] Modal result: {result}")
    return result


async def process_video_local(
    job_id: str,
    user_id: str,
    job_type: str,
    input_key: str,
    output_key: str,
    params: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Fallback: Process video locally with FFmpeg.
    Used when MODAL_ENABLED=false.
    """
    # Import local processing (existing code)
    from routers.export.framing import process_framing_local
    from routers.export.overlay import process_overlay_local

    logger.info(f"[{job_id}] Processing locally: {job_type}")

    if job_type == "framing":
        return await process_framing_local(job_id, user_id, input_key, output_key, params)
    elif job_type == "overlay":
        return await process_overlay_local(job_id, user_id, input_key, output_key, params)
    else:
        return {"status": "error", "error": f"Unknown job type: {job_type}"}


async def process_video(
    job_id: str,
    user_id: str,
    job_type: str,
    input_key: str,
    output_key: str,
    params: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Process video - uses Modal if enabled, else falls back to local FFmpeg.
    """
    if MODAL_ENABLED:
        return await process_video_modal(
            job_id, user_id, job_type, input_key, output_key, params
        )
    else:
        return await process_video_local(
            job_id, user_id, job_type, input_key, output_key, params
        )
```

### New: Database table for export jobs

Add to database schema:

```sql
CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    project_id INTEGER,
    game_id INTEGER,
    type TEXT NOT NULL,  -- 'framing', 'overlay', 'annotate'
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'processing', 'complete', 'error'
    progress INTEGER DEFAULT 0,
    input_key TEXT,
    output_key TEXT,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
```

### Modified: routers/export/overlay.py

```python
import uuid
import asyncio
from fastapi import APIRouter, HTTPException, BackgroundTasks
from services.modal_client import process_video

router = APIRouter()


@router.post("/overlay/start")
async def start_overlay_export(
    request: OverlayExportRequest,
    background_tasks: BackgroundTasks
):
    """
    Start an overlay export job.
    Returns job_id immediately - poll /overlay/status/{job_id} for progress.
    """
    user_id = get_current_user_id()
    job_id = str(uuid.uuid4())

    # Get working video path from project
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
        output_key = f"final_videos/overlay_{job_id}.mp4"

        # Create job record
        cursor.execute("""
            INSERT INTO export_jobs (id, project_id, type, status, input_key, output_key)
            VALUES (?, ?, 'overlay', 'pending', ?, ?)
        """, (job_id, request.project_id, input_key, output_key))
        conn.commit()

    # Run processing in background
    background_tasks.add_task(
        run_export_job,
        job_id=job_id,
        user_id=user_id,
        job_type="overlay",
        input_key=input_key,
        output_key=output_key,
        params={
            "highlight_regions": [r.dict() for r in request.highlight_regions],
            "effect_type": request.effect_type,
        }
    )

    return {"job_id": job_id, "status": "processing"}


async def run_export_job(
    job_id: str,
    user_id: str,
    job_type: str,
    input_key: str,
    output_key: str,
    params: dict,
):
    """Background task to run export and update status."""
    try:
        # Update status to processing
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE export_jobs SET status = 'processing' WHERE id = ?",
                (job_id,)
            )
            conn.commit()

        # Call Modal (or local fallback)
        result = await process_video(
            job_id=job_id,
            user_id=user_id,
            job_type=job_type,
            input_key=input_key,
            output_key=output_key,
            params=params,
        )

        # Update final status
        with get_db_connection() as conn:
            cursor = conn.cursor()
            if result["status"] == "success":
                cursor.execute("""
                    UPDATE export_jobs
                    SET status = 'complete', completed_at = datetime('now')
                    WHERE id = ?
                """, (job_id,))
            else:
                cursor.execute("""
                    UPDATE export_jobs SET status = 'error', error = ? WHERE id = ?
                """, (result.get("error", "Unknown error"), job_id))
            conn.commit()

    except Exception as e:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE export_jobs SET status = 'error', error = ? WHERE id = ?
            """, (str(e), job_id))
            conn.commit()


@router.get("/overlay/status/{job_id}")
async def get_overlay_status(job_id: str):
    """Get status of an overlay export job."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
        job = cursor.fetchone()

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        return {
            "job_id": job_id,
            "status": job["status"],
            "progress": job["progress"],
            "output_key": job["output_key"] if job["status"] == "complete" else None,
            "error": job["error"] if job["status"] == "error" else None,
        }
```

---

## Environment Variables

Add to `.env`:

```bash
# Enable Modal for GPU processing (set to false for local FFmpeg)
MODAL_ENABLED=true

# Modal credentials (only needed on Fly.io, CLI uses local auth)
MODAL_TOKEN_ID=xxx
MODAL_TOKEN_SECRET=xxx
```

---

## API Changes

| Old Endpoint | New Endpoint | Notes |
|--------------|--------------|-------|
| `POST /api/export/overlay` | `POST /api/export/overlay/start` | Returns immediately |
| (none) | `GET /api/export/overlay/status/{job_id}` | Poll for progress |
| (none) | `GET /api/export/jobs` | List all jobs |

---

## Local Development

Local dev can use either:

1. **Local FFmpeg** (default): `MODAL_ENABLED=false`
   - No Modal account needed
   - Processes on your machine

2. **Modal GPU**: `MODAL_ENABLED=true`
   - Uses Modal's cloud GPU
   - Requires `modal token new`

---

## Deliverables

| Item | Description |
|------|-------------|
| services/modal_client.py | Modal function caller |
| export_jobs table | Job tracking schema |
| Updated export routers | Async job submission |
| Environment variable | MODAL_ENABLED toggle |

---

## Next Step
Task 08 - Frontend Export Updates (poll for job status, show progress)
