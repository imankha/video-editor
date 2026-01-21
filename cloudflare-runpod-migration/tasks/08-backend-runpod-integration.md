# Task 08: Backend RunPod Integration

## Overview
Update the FastAPI backend to submit export jobs to RunPod instead of processing locally.

## Owner
**Claude** - Code generation task

## Prerequisites
- Task 07 complete (GPU worker deployed to RunPod)
- R2 storage working (Tasks 01-04)

## Testability
**After this task**: Export buttons in the app trigger RunPod processing. Progress shows in UI. Results appear in downloads.

---

## What Changes

| Before | After |
|--------|-------|
| Backend processes video locally | Backend submits job to RunPod |
| Blocking export (wait for result) | Async job (returns immediately) |
| Progress via local WebSocket | Progress via polling/callback |
| Output saved to local filesystem | Output saved to R2 by GPU worker |

---

## Files to Create/Modify

### New: services/runpod_client.py

```python
"""
Client for submitting jobs to RunPod serverless endpoint.
"""

import httpx
import os
from typing import Dict, Any, Optional

RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY", "")
RUNPOD_ENDPOINT_URL = os.getenv("RUNPOD_ENDPOINT_URL", "")


class RunPodClient:
    def __init__(self):
        self.endpoint_url = RUNPOD_ENDPOINT_URL
        self.headers = {
            "Authorization": f"Bearer {RUNPOD_API_KEY}",
            "Content-Type": "application/json",
        }

    async def submit_job(
        self,
        job_id: str,
        user_id: str,
        job_type: str,
        input_key: str,
        output_key: str,
        params: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Submit a job to RunPod.

        Returns:
            {"id": "runpod-job-id", "status": "IN_QUEUE"}
        """
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.endpoint_url}/run",
                headers=self.headers,
                json={
                    "input": {
                        "job_id": job_id,
                        "user_id": user_id,
                        "type": job_type,
                        "input_key": input_key,
                        "output_key": output_key,
                        "params": params,
                    }
                },
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json()

    async def get_job_status(self, runpod_job_id: str) -> Dict[str, Any]:
        """
        Get status of a RunPod job.

        Returns:
            {"id": "...", "status": "COMPLETED|IN_PROGRESS|FAILED", "output": {...}}
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.endpoint_url}/status/{runpod_job_id}",
                headers=self.headers,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()


runpod_client = RunPodClient()
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
    runpod_job_id TEXT,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
```

### Modified: routers/export/overlay.py

```python
@router.post("/overlay/start")
async def start_overlay_export(request: OverlayExportRequest):
    """
    Start an overlay export job via RunPod.

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

    # Submit to RunPod
    try:
        result = await runpod_client.submit_job(
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

        # Store RunPod job ID
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE export_jobs SET runpod_job_id = ?, status = 'processing'
                WHERE id = ?
            """, (result["id"], job_id))
            conn.commit()

        return {"job_id": job_id, "status": "processing"}

    except Exception as e:
        # Mark as error
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE export_jobs SET status = 'error', error = ? WHERE id = ?
            """, (str(e), job_id))
            conn.commit()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/overlay/status/{job_id}")
async def get_overlay_status(job_id: str):
    """
    Get status of an overlay export job.
    """
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM export_jobs WHERE id = ?", (job_id,))
        job = cursor.fetchone()

        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        # If still processing, check RunPod
        if job["status"] == "processing" and job["runpod_job_id"]:
            try:
                runpod_status = await runpod_client.get_job_status(job["runpod_job_id"])

                if runpod_status["status"] == "COMPLETED":
                    cursor.execute("""
                        UPDATE export_jobs
                        SET status = 'complete', completed_at = datetime('now')
                        WHERE id = ?
                    """, (job_id,))
                    conn.commit()
                    return {"job_id": job_id, "status": "complete", "output_key": job["output_key"]}

                elif runpod_status["status"] == "FAILED":
                    error = runpod_status.get("error", "Unknown error")
                    cursor.execute("""
                        UPDATE export_jobs SET status = 'error', error = ? WHERE id = ?
                    """, (error, job_id))
                    conn.commit()
                    return {"job_id": job_id, "status": "error", "error": error}

            except Exception as e:
                pass  # If RunPod check fails, return cached status

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
RUNPOD_API_KEY=your_api_key
RUNPOD_ENDPOINT_URL=https://api.runpod.ai/v2/your_endpoint_id
```

---

## API Changes

| Old Endpoint | New Endpoint | Notes |
|--------------|--------------|-------|
| `POST /api/export/overlay` | `POST /api/export/overlay/start` | Returns immediately |
| (none) | `GET /api/export/overlay/status/{job_id}` | Poll for progress |
| (none) | `GET /api/export/jobs` | List all jobs |

---

## Handoff Notes

**For Task 09 (Frontend Export Updates):**
- Backend API shape changed (start + poll instead of blocking)
- Frontend needs to poll for status or use SSE
- Output is in R2, use presigned URL for download
