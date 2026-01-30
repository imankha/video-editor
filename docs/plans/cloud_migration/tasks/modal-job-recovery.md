# Modal Job Recovery Strategy

## Goal

Make ALL Modal exports fully recoverable with progress bars that survive:
1. **Navigation within app** - WebSocket reconnects seamlessly
2. **Leaving site entirely** - Return to find progress/completion
3. **Backend crash/restart** - Jobs continue on Modal, state recovered

## Current State

### What Works
- `export_jobs` table tracks job state (pending → processing → complete/error)
- `useExportRecovery` hook fetches `/api/exports/active` on app startup
- WebSocket sends progress updates during active connection
- Jobs are marked 'stale' after 15 minutes without completion

### What's Broken
1. **Progress is fake** - Backend estimates progress based on time, not real Modal progress
2. **No Modal call_id stored** - Can't reconnect to running Modal jobs
3. **15-minute timeout kills real jobs** - 40-minute multi-clip exports marked as stale
4. **WebSocket-only progress** - If user navigates, progress is lost until recovery hook runs

## Architecture

### Modal Job Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           MODAL CLOUD                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Modal Function (runs independently)                            │   │
│  │  - Downloads from R2                                            │   │
│  │  - Processes video (GPU)                                        │   │
│  │  - Uploads result to R2                                         │   │
│  │  - Returns result dict                                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│            ▲                                                            │
│            │ .spawn() returns call_id                                   │
│            │                                                            │
└────────────┼────────────────────────────────────────────────────────────┘
             │
┌────────────┼────────────────────────────────────────────────────────────┐
│            ▼                         OUR BACKEND                        │
│  ┌──────────────────┐     ┌───────────────┐     ┌──────────────────┐   │
│  │ Export Endpoint  │────▶│ export_jobs   │────▶│ WebSocket        │   │
│  │ - Creates job    │     │ - modal_call_id│    │ - Progress       │   │
│  │ - Spawns Modal   │     │ - status      │     │ - Complete       │   │
│  │ - Stores call_id │     │ - error       │     │ - Error          │   │
│  └──────────────────┘     └───────────────┘     └──────────────────┘   │
│            │                      ▲                      │              │
└────────────┼──────────────────────┼──────────────────────┼──────────────┘
             │                      │                      │
             │                      │ Status poll          │ Progress
             │                      │                      │ updates
             ▼                      │                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                      │
│  ┌──────────────────┐     ┌───────────────┐     ┌──────────────────┐   │
│  │ useExportRecovery│     │ Poll endpoint │     │ Progress UI      │   │
│  │ - On app load    │     │ - If WS dead  │     │ - From WS        │   │
│  │ - Fetch active   │     │ - Modal status│     │ - From poll      │   │
│  └──────────────────┘     └───────────────┘     └──────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Modal Call ID Tracking (Required for Recovery)

**Status**: `DONE` (for multi_clip, pending for framing_ai and overlay)

**Goal**: Store Modal call_id so we can check job status later.

#### 1.1 Database Migration

Add `modal_call_id` column to `export_jobs`:

```python
# In database.py init_db()
cursor.execute("""
    ALTER TABLE export_jobs ADD COLUMN modal_call_id TEXT
""")
```

#### 1.2 Use Modal spawn() Instead of remote()

Current code (fire-and-forget):
```python
result = process_multi_clip.remote(**args)  # Blocks until done
```

New code (get call_id):
```python
import modal

# Spawn returns immediately with call object
call = process_multi_clip.spawn(**args)
call_id = call.object_id

# Store call_id
cursor.execute("""
    UPDATE export_jobs SET modal_call_id = ?, status = 'processing'
    WHERE id = ?
""", (call_id, export_id))

# Then poll for completion in background
result = call.get()  # Blocks until done
```

#### 1.3 New Endpoint: Check Modal Status

```python
@router.get("/{job_id}/modal-status")
async def check_modal_status(job_id: str):
    """Check real Modal job status using stored call_id."""
    job = get_export_job(job_id)
    if not job or not job.get('modal_call_id'):
        raise HTTPException(404, "Job not found or no Modal call_id")

    try:
        import modal
        call = modal.FunctionCall.from_id(job['modal_call_id'])

        # Try non-blocking get
        try:
            result = call.get(timeout=0)
            # Job is complete
            return {"status": "complete", "result": result}
        except TimeoutError:
            # Still running
            return {"status": "running"}
    except Exception as e:
        return {"status": "error", "error": str(e)}
```

### Phase 2: Frontend Recovery

**Status**: `TODO`

#### 2.1 Poll When WebSocket Disconnects

```javascript
// In ExportWebSocketManager.js
if (websocketDisconnected && exportInProgress) {
    // Fall back to polling
    const checkStatus = async () => {
        const res = await fetch(`/api/exports/${jobId}/modal-status`);
        const data = await res.json();

        if (data.status === 'complete') {
            // Refresh export list
            await refreshActiveExports();
        } else if (data.status === 'running') {
            // Check again in 5 seconds
            setTimeout(checkStatus, 5000);
        }
    };
    checkStatus();
}
```

#### 2.2 Update useExportRecovery for Long-Running Jobs

Current: 15-minute timeout marks jobs as stale
New: Check Modal status before marking stale

```python
def cleanup_stale_exports(max_age_minutes: int = 60):
    """Only mark as stale if Modal job is actually dead."""
    stale_jobs = get_jobs_older_than(max_age_minutes)

    for job in stale_jobs:
        if job['modal_call_id']:
            # Check Modal first
            status = check_modal_call_status(job['modal_call_id'])
            if status == 'running':
                continue  # Don't mark as stale

        # Actually stale
        mark_as_error(job['id'], 'Export timed out')
```

### Phase 3: User-Triggered Lazy Recovery

**Status**: `DONE`

Recovery happens per-user when they return to the app, NOT on backend startup.
This scales to millions of users (we don't scan all jobs on startup).

**Flow:**
```
User returns to app
    → useExportRecovery fetches GET /api/exports/active (their jobs only)
    → For each "processing" job, frontend calls GET /exports/{id}/modal-status
    → /modal-status checks Modal:
        - If running: returns {status: "running"}
        - If complete: calls finalize_modal_export() to create working_video, update project
        - If failed: updates export_jobs to error
    → Frontend shows appropriate UI
```

**Implementation in exports.py:**
```python
# /modal-status endpoint now does lazy finalization
if job['status'] == 'processing' and result.get('status') == 'success':
    # Modal finished while user was gone - finalize now
    finalization = finalize_modal_export(job, result, user_id)
    # Creates working_video, updates project, marks export complete
```

### Phase 4: Real Progress from Modal (Optional Enhancement)

**Status**: `FUTURE`

Instead of fake time-based progress, Modal could report real progress via R2:

```python
# In Modal function
def progress_callback(percent, message):
    r2.put_object(
        Key=f"temp/progress/{job_id}.json",
        Body=json.dumps({"progress": percent, "message": message})
    )

# Backend polls R2 for progress
def get_real_progress(job_id):
    try:
        obj = r2.get_object(Key=f"temp/progress/{job_id}.json")
        return json.loads(obj['Body'].read())
    except:
        return None
```

## Files to Modify

| File | Changes |
|------|---------|
| `app/database.py` | Add `modal_call_id` column to export_jobs |
| `app/services/modal_client.py` | Use `.spawn()` instead of `.remote()`, return call_id |
| `app/routers/export/multi_clip.py` | Store call_id, use new modal_client API |
| `app/routers/exports.py` | Add `/modal-status` endpoint, update stale detection |
| `app/main.py` | Add startup recovery for in-progress jobs |
| `frontend/services/ExportWebSocketManager.js` | Poll on disconnect |
| `frontend/hooks/useExportRecovery.js` | Handle long-running jobs |

## Migration Notes

- **Backwards compatible**: Old jobs without `modal_call_id` will be marked stale on restart
- **No data loss**: Modal jobs complete regardless of backend state; results are in R2
- **Graceful degradation**: If Modal API fails, fall back to existing behavior

## Testing Checklist

- [ ] Export completes when user navigates to different page
- [ ] Export completes when user closes browser, returns later
- [ ] User returns after backend restart → export finalized via /modal-status
- [ ] Progress bar reconnects on page refresh
- [ ] 40-minute exports are NOT marked stale (stale detection checks Modal first)
- [ ] Cancelled jobs are actually cancelled on Modal

## What's Implemented

| Component | Status | Notes |
|-----------|--------|-------|
| `modal_call_id` column | DONE | Added to export_jobs table |
| `spawn()` instead of `remote()` | DONE | All 3 functions: multi_clip, framing_ai, overlay |
| `call_id_callback` | DONE | Stores call_id immediately after spawn |
| `/modal-status` endpoint | DONE | Checks Modal, finalizes if complete |
| `finalize_modal_export()` | DONE | Creates working_video, updates project |
| Smart stale detection | DONE | Checks Modal before marking stale |
| Stale timeout increased | DONE | 15min → 60min for long Modal jobs |
| export_jobs tracking | DONE | All export types create/update export_jobs |

## Dependencies

- Modal SDK installed (already present)
- `export_jobs` table exists (already present)
- WebSocket infrastructure (already present)
