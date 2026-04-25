# T1110: Non-Blocking Export I/O

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-04-08
**Updated:** 2026-04-24
**Epic:** [Export Pipeline](EPIC.md) (task 1 of 2)

## Problem

Export endpoints block the Fly.io event loop for 4-120+ seconds, making the entire server unresponsive during exports. Health checks, WebSocket, auth, and all other requests are unservable during these windows.

### Root Cause (NOT what you'd expect)

The Modal RPC calls are **already non-blocking**. `modal_client.py` properly uses `loop.run_in_executor()` for all three call functions (`call_modal_framing_ai`, `call_modal_clips_ai`, `call_modal_overlay_auto`). The event loop yields during Modal GPU processing.

The **actual blockers** are synchronous I/O calls that run directly on the event loop thread **before and after** the Modal calls:

| Blocking Call | File:Line | What It Does | Duration |
|---|---|---|---|
| `get_video_info(source_url)` | `framing.py:932` | `subprocess.run(ffprobe)` on R2 presigned URL | ~4s |
| `download_from_r2(...)` | `framing.py:1035` | Sync HTTP download from R2 | 5-15s |
| `get_video_duration(output_path)` | `framing.py:1039` | `subprocess.run(ffprobe)` on local file | 0.5-2s |
| `ffmpeg.input().output().run()` | `multi_clip.py:1366-1370` | Sync ffmpeg clip extraction from R2 stream | 2-10s |
| `download_from_r2(...)` | `multi_clip.py:1394` | Sync HTTP download (uploaded clips) | 5-15s |
| `download_from_r2(...)` | `multi_clip.py:1416` | Sync HTTP download (raw clips) | 5-15s |
| `upload_bytes_to_r2(...)` | `multi_clip.py:1489` | Sync HTTP upload to R2 temp folder | varies |
| `concatenate_clips_with_transition(...)` | `multi_clip.py:1830` | `subprocess.run(ffmpeg)` concatenation | 30-120s |
| `get_video_duration(final_output)` | `multi_clip.py:1841` | `subprocess.run(ffprobe)` on local file | 0.5-2s |

`overlay.py` has the same pattern in its Modal path (line 2066 onward) but fewer surrounding sync calls since it delegates heavy lifting to Modal.

**Additionally, these calls block the event loop in background tasks and local paths:**

| Blocking Call | File:Line | What It Does | Duration |
|---|---|---|---|
| `get_video_info(source_url)` | `framing.py:468-478` | ffprobe in `_run_local_framing_export` background task | ~4s |
| `download_from_r2(...)` | `framing.py:551` | R2 download in `_run_local_framing_export` background task | 5-15s |
| `get_video_duration(...)` | `framing.py:556` | ffprobe in `_run_local_framing_export` background task | 0.5-2s |
| `AIVideoUpscaler()` | `multi_clip.py:1712` | Loads Real-ESRGAN model into VRAM (sync CUDA) | 10-30s |
| `threading.Thread.join(timeout=10)` | `multi_clip.py:1886` | R2 upload polling loop, holds async context | 60-120s total |
| `shutil.copy()` | `multi_clip.py:1085` | N=1 concat case: sync file copy | 10-60s |
| `cv2.VideoCapture().get()` | `overlay.py:1274-1275` | OpenCV metadata read for video dimensions | ~1s |
| `archive_project()` | `overlay.py:2125, 1672` | Sync function in both Modal and background paths | ~1s |

### Incident context

This was discovered in production-like conditions: user clicked "Frame Video" on a multi-clip reel, the export started downloading source videos from R2 synchronously, and the server became unreachable for 6+ minutes. A hard refresh couldn't reconnect because the server couldn't accept new requests. WebSocket disconnected after ~6s of the blocked request. Quest progress couldn't refresh during the block, causing quest steps to appear stuck.

### Why this matters

Staging runs `MODAL_ENABLED=true` on a single Fly.io instance. A multi-clip export with 3 clips can block the event loop for 30+ seconds cumulative across ffprobe/download/concat calls. During those windows, the server is completely unresponsive.

## Solution

Wrap every synchronous I/O call in the export paths with `asyncio.to_thread()`. This is the same pattern `local_processors.py` already uses (e.g., line 429).

### Fix pattern

```python
# BEFORE (blocks event loop):
source_info = get_video_info(source_url)

# AFTER (yields event loop to thread pool):
source_info = await asyncio.to_thread(get_video_info, source_url)
```

### Changes by file

#### `framing.py` — Modal path (`render_project`, line 910+)

**1. ffprobe for framerate (line 932)**
```python
# CURRENT (line 932):
source_info = get_video_info(source_url)

# CHANGE TO:
source_info = await asyncio.to_thread(get_video_info, source_url)
```

**2. Download output from R2 (line 1035)**
```python
# CURRENT (line 1035):
if not download_from_r2(user_id, output_key, Path(output_path)):

# CHANGE TO:
if not await asyncio.to_thread(download_from_r2, user_id, output_key, Path(output_path)):
```

**3. Measure output duration (line 1039)**
```python
# CURRENT (line 1039):
video_duration = get_video_duration(output_path)

# CHANGE TO:
video_duration = await asyncio.to_thread(get_video_duration, output_path)
```

**4. `_run_local_framing_export` background task (lines 468-478)**

This runs inside `asyncio.create_task` so it already doesn't block the HTTP response, but it still blocks the event loop thread within its coroutine. Apply the same wraps:

```python
# Line 468-478 — ffprobe in background task:
source_info = await asyncio.to_thread(get_video_info, source_url)

# Line 551 — download in background task:
await asyncio.to_thread(download_from_r2, user_id, output_key, Path(output_path))

# Line 556 — duration in background task:
video_duration = await asyncio.to_thread(get_video_duration, output_path)
```

#### `multi_clip.py` — Both paths (`export_multi_clip`, line 1153+)

**5. DB-resolved clip extraction via ffmpeg (lines 1366-1370)**
```python
# CURRENT (lines 1366-1370):
(
    ffmpeg_lib
    .input(source_url, ss=source_start_time, to=source_end_time)
    .output(input_path, c='copy')
    .overwrite_output()
    .run(capture_stdout=True, capture_stderr=True)
)

# CHANGE TO:
def _extract_clip():
    (
        ffmpeg_lib
        .input(source_url, ss=source_start_time, to=source_end_time)
        .output(input_path, c='copy')
        .overwrite_output()
        .run(capture_stdout=True, capture_stderr=True)
    )

await asyncio.to_thread(_extract_clip)
```

**6. download_from_r2 calls (lines 1394, 1416)**
```python
# CURRENT (line 1394):
if not download_from_r2(captured_user_id, r2_key, clip_path):

# CHANGE TO:
if not await asyncio.to_thread(download_from_r2, captured_user_id, r2_key, clip_path):

# Same for line 1416
```

**7. upload_bytes_to_r2 in Modal path (line 1489)**
```python
# CURRENT (line 1489):
upload_bytes_to_r2(captured_user_id, source_key, content)

# CHANGE TO:
await asyncio.to_thread(upload_bytes_to_r2, captured_user_id, source_key, content)
```

**8. Concatenation (line 1830)**
```python
# CURRENT (line 1830):
concatenate_clips_with_transition(
    clip_paths=processed_paths,
    output_path=final_output,
    transition=transition,
    include_audio=include_audio_bool,
    clip_info=sorted_clips
)

# CHANGE TO:
await asyncio.to_thread(
    concatenate_clips_with_transition,
    clip_paths=processed_paths,
    output_path=final_output,
    transition=transition,
    include_audio=include_audio_bool,
    clip_info=sorted_clips,
)
```

**9. Final duration measurement (line 1841)**
```python
# CURRENT (line 1841):
video_duration = get_video_duration(final_output)

# CHANGE TO:
video_duration = await asyncio.to_thread(get_video_duration, final_output)
```

#### `multi_clip.py` — Local path additional blocks

**10. AIVideoUpscaler initialization (line 1712)**

This loads the Real-ESRGAN neural network model from disk into VRAM — a 10-30s synchronous CUDA operation. It must run in a thread:
```python
# CURRENT (line 1712):
upscaler = AIVideoUpscaler(device='cuda', model_name='realesr_general_x4v3')

# CHANGE TO:
upscaler = await asyncio.to_thread(
    AIVideoUpscaler, device='cuda', model_name='realesr_general_x4v3'
)
```

**11. R2 upload with threading.Thread + .join() (lines 1872-1886)**

The upload runs in a `threading.Thread` but the main coroutine polls with `thread.join(timeout=10)` in a `while` loop, blocking the event loop for the entire upload (60-120s). Replace with `asyncio.to_thread`:
```python
# CURRENT (lines 1862-1886):
def do_upload():
    upload_to_r2(captured_user_id, f"working_videos/{working_filename}", Path(final_output))

upload_thread = threading.Thread(target=do_upload)
upload_thread.start()
while upload_thread.is_alive():
    # progress heartbeat
    upload_thread.join(timeout=10)

# CHANGE TO:
async def do_upload_with_progress():
    await asyncio.to_thread(
        upload_to_r2, captured_user_id,
        f"working_videos/{working_filename}", Path(final_output)
    )

upload_task = asyncio.create_task(do_upload_with_progress())
# Send progress heartbeats while waiting:
while not upload_task.done():
    await manager.send_progress(export_id, {"progress": 85, "message": "Uploading..."})
    await asyncio.sleep(5)
await upload_task
```

**12. shutil.copy for N=1 concatenation (line 1085 in `concatenate_clips_with_transition`)**

When there's only 1 clip, the function does a sync `shutil.copy()` instead of ffmpeg concat. This is already wrapped if change #8 is applied (the whole function runs in `asyncio.to_thread`).

#### `overlay.py` — Modal path (`render_overlay`, line 1723+)

**13. cv2.VideoCapture for video dimensions (lines 1271-1277)**

Blocking OpenCV call that reads video metadata from disk:
```python
# CURRENT (lines 1271-1277):
cap = cv2.VideoCapture(str(wv_path))
if cap.isOpened():
    working_video_dims = {
        'width': int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    }
    cap.release()

# CHANGE TO:
def _get_video_dims(path):
    cap = cv2.VideoCapture(str(path))
    if cap.isOpened():
        dims = {
            'width': int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        }
        cap.release()
        return dims
    return None

working_video_dims = await asyncio.to_thread(_get_video_dims, wv_path)
```

**14. archive_project() (lines 2125 and 1672)**

Sync function called in both Modal and `_run_local_overlay_export` paths:
```python
# CURRENT (line 2125):
archive_project(project_id, user_id)

# CHANGE TO:
await asyncio.to_thread(archive_project, project_id, user_id)
```

**15. DB operations in Modal path (lines 2088-2120) and background task (lines 1640-1667)**

These are SQLite queries (instant, <1ms). Same as framing/multi_clip — not worth threading. No change needed.

### What NOT to change

- `modal_client.py` — Already correct. Uses `run_in_executor`.
- `local_processors.py` — Already correct. Uses `asyncio.to_thread`.
- SQLite queries — These are in-process and effectively instant (<1ms). Not worth the overhead of threading.
- `reserve_credits()` / `confirm_reservation()` — Pure SQLite, instant.

### Import

Add to top of each modified file (if not already present):
```python
import asyncio
```

## Verification

1. Start backend with `MODAL_ENABLED=true` (or staging)
2. Trigger a multi-clip export (3+ clips)
3. During export, verify in another terminal:
   - `curl http://localhost:8000/health` responds immediately (not after export completes)
   - WebSocket connections can be established
   - Other API endpoints respond normally
4. Export still completes successfully with correct output

## Acceptance Criteria

- [ ] All `subprocess.run()` calls in export paths run via `asyncio.to_thread()` (ffprobe, ffmpeg, concat)
- [ ] All `download_from_r2()` / `upload_bytes_to_r2()` / `upload_to_r2()` calls in export paths run via `asyncio.to_thread()`
- [ ] `AIVideoUpscaler()` init in multi_clip.py runs via `asyncio.to_thread()`
- [ ] `threading.Thread` + `.join()` R2 upload loop in multi_clip.py replaced with `asyncio.to_thread` pattern
- [ ] `cv2.VideoCapture` metadata read in overlay.py runs via `asyncio.to_thread()`
- [ ] `archive_project()` in overlay.py runs via `asyncio.to_thread()`
- [ ] Background tasks (`_run_local_framing_export`, `_run_local_overlay_export`) also have their sync calls wrapped
- [ ] Server responds to `/health` during a multi-clip Modal export
- [ ] No behavioral changes to export output, progress reporting, or error handling
