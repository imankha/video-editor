# T249 Design: Robust Extraction Recovery

**Status:** DRAFT
**Author:** Architect Agent
**Approved:** -

## Code Expert Findings

### Key Discovery: Status Mapping Bug

The frontend checks `extraction_status === 'processing'` to set `isExtracting` (`useProjectLoader.js:85`), but the backend sends `'running'` (from `modal_tasks.status`). This means the "Extracting..." spinner in ClipSelectorSidebar **never shows** — clips always show "Waiting for extraction" regardless of actual state. This pre-existing bug must be fixed as part of this task.

### Extraction Lifecycle Trace

```
1. User opens project → GET /api/clips/projects/{id}/clips
2. clips.py:1148-1152 finds clips without raw_filename → clips_needing_extraction
3. clips.py:1175-1181 checks already_queued: SELECT from modal_tasks WHERE status IN ('pending', 'running')
4. clips.py:1198-1207 enqueues new tasks via enqueue_clip_extraction() → INSERT status='pending'
5. clips.py:1208 adds background task: run_queue_processor_sync()
6. modal_queue.py:112-117 process_modal_queue() finds pending/running tasks
7. modal_queue.py:128-132 marks all as 'running' with started_at timestamp
8. modal_queue.py:194-201 calls Modal/FFmpeg (NO timeout)
9. On success: modal_queue.py:215-223 updates raw_clips.filename + task 'completed'
10. modal_queue.py:228-232 broadcasts extraction_complete via WebSocket
11. websocket.py:177-194 broadcast to all connected clients (fire-and-forget)
12. Frontend FramingScreen.jsx:160-166 WebSocket listener calls fetchProjectClips()
```

---

## Current State ("As Is")

### Status State Machine

```
pending → running → completed
                  → failed (terminal, no recovery except re-enqueue on project open)
```

### Failure Modes (8 total)

| # | Mode | Current Behavior |
|---|------|------------------|
| 1 | Task stuck 'running' | No timeout. Stays running forever. Only recovered on server restart |
| 2 | Task failed, no retry | Failed is terminal. No retry mechanism |
| 3 | `already_queued` ignores failed | Failed clips re-enqueue every project open → duplicate tasks |
| 4 | No extraction timeout | Modal/FFmpeg can hang indefinitely |
| 5 | WebSocket missed | Broadcast dropped if no clients connected |
| 6 | No 'failed' UI state | Failed clips show "Waiting for extraction" |
| 7 | No spinner timeout | Spinner runs forever if WebSocket event lost |
| 8 | No retry button | Users can't manually retry |

### Pre-existing Bug

`useProjectLoader.js:85` maps `isExtracting = extraction_status === 'processing'`, but backend sends `'running'`. Frontend never shows extracting state correctly.

---

## Target State ("Should Be")

### Status State Machine (New)

```
                    ┌──────────────────────────┐
                    │                          │
                    v                          │ (auto-retry, attempt < 3)
pending ──→ running ──→ completed              │
                    │                          │
                    └──→ failed ───────────────┘
                         │
                         └──→ pending (manual retry via API)
```

New columns in `modal_tasks`:
- `retry_count INTEGER DEFAULT 0` — tracks auto-retry attempts
- No other schema changes needed (`started_at` already exists for timeout detection)

### Target Behavior Summary

**Backend:**
1. Stale task timeout: `process_modal_queue()` marks tasks 'failed' if running > 10 min
2. Auto-retry: failed tasks with `retry_count < 3` auto-reset to 'pending' with backoff
3. Retry endpoint: `POST /api/clips/projects/{pid}/clips/{cid}/retry-extraction` resets failed task
4. Dedup fix: `already_queued` also checks 'failed' tasks with `retry_count >= 3` (exhausted retries)
5. Health check: `GET /api/extraction/health` shows queue stats

**Frontend:**
1. Fix status mapping: `isExtracting` = `extraction_status === 'running'` (not 'processing')
2. Failed state: ClipSelectorSidebar shows "Extraction failed" with retry button
3. Polling fallback: FramingScreen polls clips API every 30s when anyExtracting
4. Spinner timeout: Show "Taking longer than expected" after 5 minutes

---

## Implementation Plan ("Will Be")

### Files to Modify

| # | File | Change |
|---|------|--------|
| 1 | `src/backend/app/database.py` | Add `retry_count` column to modal_tasks schema |
| 2 | `src/backend/app/services/modal_queue.py` | Stale timeout, auto-retry with backoff |
| 3 | `src/backend/app/routers/clips.py` | Retry endpoint, fix `already_queued` check |
| 4 | `src/backend/app/websocket.py` | No changes needed (broadcast is fine as fire-and-forget with polling fallback) |
| 5 | `src/frontend/src/hooks/useProjectLoader.js` | Fix `isExtracting` status mapping, add `isFailed` |
| 6 | `src/frontend/src/components/ClipSelectorSidebar.jsx` | Failed state UI with retry button |
| 7 | `src/frontend/src/screens/FramingScreen.jsx` | Polling fallback, spinner timeout |
| 8 | `src/backend/tests/test_extraction_recovery.py` | Backend tests |
| 9 | `src/frontend/src/components/ClipSelectorSidebar.test.jsx` | Frontend tests |

### Pseudo Code Changes

#### 1. database.py — Add retry_count column

```python
# In modal_tasks CREATE TABLE:
+ retry_count INTEGER DEFAULT 0,

# Add migration in ensure_schema():
+ try_add_column(cursor, "modal_tasks", "retry_count", "INTEGER DEFAULT 0")
```

#### 2. modal_queue.py — Stale timeout + auto-retry

```python
STALE_TASK_TIMEOUT_MINUTES = 10
MAX_RETRY_COUNT = 3
RETRY_BACKOFF_SECONDS = [60, 300, 900]  # 1min, 5min, 15min

async def process_modal_queue():
    # Phase 0: Mark stale 'running' tasks as 'failed'
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE modal_tasks
            SET status = 'failed',
                completed_at = CURRENT_TIMESTAMP,
                error = 'Timed out after 10 minutes'
            WHERE status = 'running'
            AND started_at < datetime('now', '-10 minutes')
        """)
        stale_count = cursor.rowcount
        if stale_count > 0:
            conn.commit()
            logger.warning(f"[ModalQueue] Timed out {stale_count} stale running tasks")

    # Phase 0.5: Auto-retry failed tasks with retry_count < MAX
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Find failed tasks eligible for retry (with backoff check)
        cursor.execute("""
            SELECT id, retry_count, completed_at FROM modal_tasks
            WHERE status = 'failed'
            AND retry_count < ?
        """, (MAX_RETRY_COUNT,))
        for task in cursor.fetchall():
            retry_count = task['retry_count']
            backoff_secs = RETRY_BACKOFF_SECONDS[min(retry_count, len(RETRY_BACKOFF_SECONDS)-1)]
            # Check if enough time has passed since failure
            cursor.execute("""
                UPDATE modal_tasks
                SET status = 'pending', retry_count = retry_count + 1,
                    error = NULL, started_at = NULL, completed_at = NULL
                WHERE id = ? AND status = 'failed'
                AND completed_at < datetime('now', ? || ' seconds')
            """, (task['id'], f'-{backoff_secs}'))
        conn.commit()

    # Phase 1: existing pending/running logic (unchanged)
    # Phase 2: existing processing logic (unchanged)
```

#### 3. clips.py — Retry endpoint + dedup fix

```python
# Fix already_queued to include exhausted failed tasks
cursor.execute("""
    SELECT raw_clip_id FROM modal_tasks
    WHERE raw_clip_id IN ({placeholders})
    AND task_type = 'clip_extraction'
    AND (
        status IN ('pending', 'running')
        OR (status = 'failed' AND retry_count < 3)
    )
""", raw_clip_ids)

# New retry endpoint
@router.post("/projects/{project_id}/clips/{clip_id}/retry-extraction")
async def retry_extraction(project_id: int, clip_id: int, background_tasks: BackgroundTasks):
    """Manually retry a failed extraction for a specific clip."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Find the failed task for this clip
        cursor.execute("""
            SELECT id FROM modal_tasks
            WHERE raw_clip_id = (
                SELECT raw_clip_id FROM working_clips WHERE id = ?
            )
            AND task_type = 'clip_extraction'
            AND status = 'failed'
            ORDER BY created_at DESC LIMIT 1
        """, (clip_id,))
        task = cursor.fetchone()
        if not task:
            raise HTTPException(404, "No failed extraction found for this clip")

        # Reset to pending with retry_count reset (manual retry)
        cursor.execute("""
            UPDATE modal_tasks
            SET status = 'pending', retry_count = 0,
                error = NULL, started_at = NULL, completed_at = NULL
            WHERE id = ?
        """, (task['id'],))
        conn.commit()

    # Trigger queue processing
    background_tasks.add_task(run_queue_processor_sync, user_id, profile_id)
    return {"status": "retrying", "task_id": task['id']}
```

#### 4. useProjectLoader.js — Fix status mapping

```javascript
// Fix: backend sends 'running', not 'processing'
isExtracted: !!backendClip.file_url,
isExtracting: backendClip.extraction_status === 'running' || backendClip.extraction_status === 'pending',
isFailed: backendClip.extraction_status === 'failed',
extractionStatus: backendClip.extraction_status || null,
```

#### 5. ClipSelectorSidebar.jsx — Failed state + retry button

```jsx
// Add isFailed to status detection
const isFailed = clip.isFailed || clip.extractionStatus === 'failed';

// In the extraction status section:
{!isExtracted ? (
  isFailed ? (
    <span className="text-red-400 flex items-center gap-1">
      <AlertTriangle size={10} />
      Failed
      <button onClick={(e) => { e.stopPropagation(); onRetryExtraction(clip.workingClipId); }}
              className="ml-1 text-xs underline hover:text-red-300">
        Retry
      </button>
    </span>
  ) : isExtracting ? (
    <span className="text-orange-400 flex items-center gap-1">
      <RefreshCw size={10} className="animate-spin" />
      Extracting...
    </span>
  ) : (
    <span className="text-gray-500 flex items-center gap-1">
      <Clock size={10} />
      Waiting for extraction
    </span>
  )
) : (/* existing extracted UI */)}
```

#### 6. FramingScreen.jsx — Polling fallback + spinner timeout

```javascript
// Add polling fallback alongside WebSocket
useEffect(() => {
  if (!extractionState.anyExtracting || !projectId) return;

  // Poll every 30s as fallback for missed WebSocket events
  const pollInterval = setInterval(() => {
    fetchProjectClips();
  }, 30000);

  return () => clearInterval(pollInterval);
}, [extractionState.anyExtracting, projectId, fetchProjectClips]);

// Add spinner timeout tracking
const [extractionStartTime] = useState(() => Date.now());
const extractionElapsed = useMemo(() => {
  if (!extractionState.allExtracting) return 0;
  return Date.now() - extractionStartTime;
}, [extractionState.allExtracting, extractionStartTime]);

// In spinner UI, after 5 minutes show timeout message
{extractionElapsed > 300000 && (
  <p className="text-amber-400 text-sm mt-2">
    Taking longer than expected. Extractions may have failed.
  </p>
)}
```

---

## Risks

| Risk | Mitigation |
|------|------------|
| Stale timeout marks legitimately slow tasks as failed | 10-minute timeout is generous for clip extraction (typically <2 min). Auto-retry with backoff handles false positives |
| Polling adds server load | 30s interval is minimal. Only active while anyExtracting (short-lived) |
| Auto-retry loop if task always fails | `retry_count` cap of 3. After 3 failures, task stays failed permanently |
| Schema migration for retry_count | SQLite ALTER TABLE ADD COLUMN is safe. Default 0 is backward-compatible |

## Open Questions

None — all design decisions are straightforward based on the task requirements.
