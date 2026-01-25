# Task 09: Testing Modal Integration

## Overview
End-to-end testing of the Modal GPU processing integration. Verify all export types work correctly.

## Owner
**Both** - User runs tests, Claude fixes issues

## Prerequisites
- Tasks 05-08 complete (Full Modal integration)

## Testability
**After this task**: Phase 2 complete. App works with local backend + Modal GPU + R2 storage.

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

- [ ] **Modal timeout**
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
  - [ ] Verify Modal function can download from R2
  - [ ] Check Modal logs for download activity

- [ ] **Output files**
  - [ ] Verify Modal function uploads to R2
  - [ ] Output appears in correct location
  - [ ] Presigned URL works for download

---

## Manual Test Commands

### Check Modal Function Logs

```bash
# View recent function invocations
modal app logs reel-ballers-video

# View specific function logs
modal app logs reel-ballers-video --function process_video
```

### Test Modal Function Directly

```bash
# Run test from command line
modal run modal_functions/video_processing.py

# Or from Python
python -c "
from modal_functions.video_processing import process_video
result = process_video.remote(
    job_id='test-cli',
    user_id='a',
    job_type='framing',
    input_key='working_videos/test.mp4',
    output_key='final_videos/test_cli.mp4',
    params={'output_width': 1080, 'output_height': 1920}
)
print(result)
"
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
- Check Modal dashboard for function status
- Verify `modal deploy` was run successfully
- Check Modal logs for startup errors

### "Download returns 404"
- Verify output_key matches actual R2 path
- Check Modal function logs for upload errors
- Verify R2 credentials in Modal secret

### "Progress never updates"
- Check polling endpoint returns correct status
- Verify job ID stored in database
- Check network tab for polling requests

### "Video corrupt after download"
- Check ffmpeg encoding parameters
- Verify file fully uploaded before marking complete
- Check R2 for partial uploads

### "Modal function not found"
- Run `modal deploy modal_functions/video_processing.py`
- Check function is deployed: `modal app list`

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
                    └──► Modal GPU ───┘
```

Phase 3 will deploy:
- FastAPI backend to Fly.io
- React frontend to Cloudflare Pages

The core functionality (exports via Modal, storage in R2) will remain the same.
