# Task 09: Testing Modal Integration

## Overview
End-to-end testing of the Modal GPU processing integration. Verify all export types work correctly.

## Status
**TESTING** - Integration complete, testing in progress

## Owner
**Both** - User runs tests, Claude fixes issues

## Prerequisites
- Tasks 05-08 complete (Full Modal integration) ✓

## What's Been Implemented

| Component | Location | Modal Function |
|-----------|----------|----------------|
| Framing (AI upscale) | `framing.py /render` | `process_framing_ai` |
| Framing (FFmpeg) | `framing.py /render` | `process_framing` |
| Overlay | `overlay.py /render-overlay` | `render_overlay`, `render_overlay_parallel` |
| Clip Extraction | `clips.py` | `extract_clip_modal` |
| Player Detection | `detect.py` | `detect_players_modal` |

### Progress Callbacks Implemented
All Modal client functions in `modal_client.py` have progress simulation:
- `call_modal_framing_ai()` - Phase-based progress with time estimation
- `call_modal_overlay()` - Progress with status messages
- `call_modal_overlay_parallel()` - Chunk-aware progress
- `call_modal_overlay_auto()` - Auto-selects sequential or parallel

### R2_ENABLED Removed
R2 is now always enabled. The following files have been cleaned up:
- `clips.py` - Uses R2 for all clip storage
- `framing.py` - Uses R2 for working videos
- `overlay.py` - Uses R2 for final videos
- `annotate.py` - Uses R2 for downloads

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
modal app logs reel-ballers-video --function render_overlay
modal app logs reel-ballers-video --function process_framing_ai
```

### Test Modal Functions Directly

```python
# Test modal_client.py from Python (in src/backend directory)
import asyncio
from app.services.modal_client import (
    modal_enabled,
    call_modal_overlay,
    call_modal_framing_ai,
)

async def test():
    print(f"Modal enabled: {modal_enabled()}")

    # Test overlay
    result = await call_modal_overlay(
        job_id="test-overlay",
        user_id="a",
        input_key="working_videos/test.mp4",
        output_key="final_videos/test_overlay.mp4",
        highlight_regions=[],
        effect_type="dark_overlay",
    )
    print(f"Overlay result: {result}")

asyncio.run(test())
```

### Verify Deployed Functions

```python
# Check which Modal functions are available
import modal
fn = modal.Function.from_name("reel-ballers-video", "render_overlay")
print(f"render_overlay: {fn}")

fn = modal.Function.from_name("reel-ballers-video", "process_framing_ai")
print(f"process_framing_ai: {fn}")

fn = modal.Function.from_name("reel-ballers-video", "extract_clip_modal")
print(f"extract_clip_modal: {fn}")
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

## Next Tasks

After testing is complete:

1. **Multi-Clip Modal Migration** (`multi_clip_modal_migration.md`)
   - Port multi-clip export to Modal
   - Uses Real-ESRGAN AI upscaling
   - Concatenation with transitions

2. **Phase 3: Production Deployment**
   - FastAPI backend to Fly.io
   - React frontend to Cloudflare Pages

### Current App Architecture

```
Frontend ──► FastAPI Backend ──► R2 Storage (always enabled)
                    │                 ▲
                    ├──► Modal GPU ───┘ (when MODAL_ENABLED=true)
                    └──► Local FFmpeg   (when MODAL_ENABLED=false)
```

The core functionality (exports via Modal, storage in R2) will remain the same in production.
