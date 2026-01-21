# Task 10: Testing RunPod Integration

## Overview
End-to-end testing of the RunPod GPU processing integration. Verify all export types work correctly.

## Owner
**Both** - User runs tests, Claude fixes issues

## Prerequisites
- Tasks 05-09 complete (Full RunPod integration)

## Testability
**After this task**: Phase 2 complete. App works with local backend + RunPod GPU + R2 storage.

---

## Test Checklist

### 1. Basic Export Flow

- [ ] **Framing Export**
  - [ ] Select a project with clips
  - [ ] Set crop keyframes
  - [ ] Click export
  - [ ] Progress indicator appears
  - [ ] Export completes
  - [ ] Download works
  - [ ] Video plays correctly

- [ ] **Overlay Export**
  - [ ] Select a project with working video
  - [ ] Add highlight regions
  - [ ] Click export
  - [ ] Progress indicator appears
  - [ ] Export completes
  - [ ] Download works
  - [ ] Overlay effect visible in video

- [ ] **Annotate Export**
  - [ ] Select a game
  - [ ] Add annotations
  - [ ] Click export
  - [ ] Progress indicator appears
  - [ ] Export completes
  - [ ] Download works
  - [ ] Annotations visible in video

### 2. Error Handling

- [ ] **RunPod timeout**
  - [ ] Submit long-running job
  - [ ] Verify timeout error shows in UI
  - [ ] Job marked as error in database

- [ ] **Invalid input**
  - [ ] Submit export with missing parameters
  - [ ] Verify error message shows
  - [ ] No partial files left in R2

- [ ] **Network failure**
  - [ ] Disconnect network during export
  - [ ] Reconnect
  - [ ] Verify export can recover or shows error

### 3. Recovery & Persistence

- [ ] **Page refresh during export**
  - [ ] Start an export
  - [ ] Refresh the page
  - [ ] Export progress indicator reappears
  - [ ] Polling resumes
  - [ ] Export completes successfully

- [ ] **Browser close/reopen**
  - [ ] Start an export
  - [ ] Close browser completely
  - [ ] Reopen app
  - [ ] Active exports shown
  - [ ] Can poll status

### 4. Concurrent Exports

- [ ] **Multiple exports**
  - [ ] Start two exports simultaneously
  - [ ] Both show progress
  - [ ] Both complete independently
  - [ ] Downloads work for both

### 5. R2 Integration

- [ ] **Input files**
  - [ ] Verify GPU worker can download from R2
  - [ ] Check R2 logs for download activity

- [ ] **Output files**
  - [ ] Verify GPU worker uploads to R2
  - [ ] Output appears in correct location
  - [ ] Presigned URL works for download

---

## Manual Test Commands

### Check RunPod Job Status

```bash
# Get API key and endpoint from .env
source .env

# Check a job status
curl "https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/status/{job_id}" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}"
```

### Check R2 Contents

```bash
# List user's files
wrangler r2 object list reel-ballers-users --prefix "a/"

# Check if output exists
wrangler r2 object get reel-ballers-users/a/final_videos/overlay_xxx.mp4
```

### Check Database Job Records

```python
# From backend directory
python -c "
import sqlite3
conn = sqlite3.connect('user_data/a/database.sqlite')
conn.row_factory = sqlite3.Row
for row in conn.execute('SELECT * FROM export_jobs ORDER BY created_at DESC LIMIT 5'):
    print(dict(row))
"
```

---

## Performance Benchmarks

| Export Type | Input Size | Expected Time | Actual Time |
|-------------|------------|---------------|-------------|
| Framing (30s clip) | 50MB | 10-20s | |
| Overlay (1min video) | 100MB | 20-40s | |
| Annotate (game) | 500MB | 60-120s | |

---

## Common Issues & Fixes

### "Job stuck in pending"
- Check RunPod dashboard for worker availability
- Verify endpoint has Max Workers > 0
- Check RunPod logs for startup errors

### "Download returns 404"
- Verify output_key matches actual R2 path
- Check GPU worker logs for upload errors
- Verify R2 credentials are correct

### "Progress never updates"
- Check polling endpoint returns correct status
- Verify RunPod job ID stored in database
- Check network tab for polling requests

### "Video corrupt after download"
- Check ffmpeg encoding parameters
- Verify file fully uploaded before marking complete
- Check R2 for partial uploads

---

## Sign-Off Criteria

Phase 2 is complete when:

- [ ] All basic export flows work
- [ ] Error cases handled gracefully
- [ ] Recovery after page refresh works
- [ ] Performance is acceptable
- [ ] No regression in existing features

---

## Next Phase

After completing Phase 2, the app architecture is:

```
Frontend ──► FastAPI Backend ──► R2 Storage
                    │                 ▲
                    └──► RunPod GPU ──┘
```

Phase 3 will migrate the FastAPI backend to Cloudflare Workers, but the core functionality (exports via RunPod, storage in R2) will remain the same.
