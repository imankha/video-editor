# Modal GPU Integration - Learnings & Best Practices

This document captures lessons learned during the Modal GPU integration for video processing. Future endpoints should reference this to avoid common pitfalls.

## Table of Contents
1. [Modal Function Architecture](#modal-function-architecture)
2. [FFmpeg Pipe Handling](#ffmpeg-pipe-handling)
3. [Progress Bar for Async Operations](#progress-bar-for-async-operations)
4. [Deployment & CLI Issues](#deployment--cli-issues)
5. [Function Naming](#function-naming)

---

## Modal Function Architecture

### Calling Deployed Functions

**Wrong approach** - importing local function definition:
```python
# DON'T DO THIS - causes "Function has not been hydrated" error
from app.modal_functions.video_processing import process_video
result = process_video.remote(...)
```

**Correct approach** - use `Function.from_name()`:
```python
import modal

# Look up the DEPLOYED function by app name and function name
fn = modal.Function.from_name("reel-ballers-video", "render_overlay")
result = fn.remote(...)
```

### Caching Function References

Cache the function reference to avoid repeated lookups:

```python
_render_overlay_fn = None

def _get_render_overlay_fn():
    global _render_overlay_fn
    if _render_overlay_fn is not None:
        return _render_overlay_fn

    import modal
    _render_overlay_fn = modal.Function.from_name(MODAL_APP_NAME, "render_overlay")
    return _render_overlay_fn
```

### Async Wrapper for Modal Calls

Modal's `.remote()` is synchronous. Wrap it in `asyncio.to_thread()` to avoid blocking:

```python
async def call_modal_overlay(...):
    render_overlay = _get_render_overlay_fn()

    result = await asyncio.to_thread(
        render_overlay.remote,
        job_id=job_id,
        user_id=user_id,
        # ... other params
    )
    return result
```

---

## FFmpeg Pipe Handling

### The `communicate()` vs `wait()` Problem

**CRITICAL**: If you close `stdin` manually, DO NOT call `communicate()` afterward.

**What happens:**
1. You process frames and write to `ffmpeg_proc.stdin`
2. You close stdin to signal EOF: `ffmpeg_proc.stdin.close()`
3. You call `communicate()` to get output
4. `communicate()` internally calls `stdin.flush()` → **ERROR: "flush of closed file"**

**Wrong approach:**
```python
try:
    while True:
        # ... process frames
        ffmpeg_proc.stdin.write(frame.tobytes())
finally:
    ffmpeg_proc.stdin.close()

# BUG: communicate() tries to flush the already-closed stdin
stdout, stderr = ffmpeg_proc.communicate()
```

**Correct approach:**
```python
try:
    while True:
        # ... process frames
        ffmpeg_proc.stdin.write(frame.tobytes())
finally:
    if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
        ffmpeg_proc.stdin.close()

# Use wait() instead - it doesn't touch stdin
ffmpeg_proc.wait()

# Read stderr manually
stderr_text = ""
if ffmpeg_proc.stderr:
    stderr_text = ffmpeg_proc.stderr.read().decode()
```

### Robust Frame Writing

Check pipe status before writing and catch errors:

```python
write_error = None

try:
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Check pipe is still open before writing
        try:
            if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
                ffmpeg_proc.stdin.write(frame.tobytes())
                ffmpeg_proc.stdin.flush()  # Ensure data is sent
            else:
                write_error = "FFmpeg stdin closed unexpectedly"
                break
        except (BrokenPipeError, OSError) as e:
            write_error = f"Pipe error at frame {frame_idx}: {e}"
            break

finally:
    cap.release()
    try:
        if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
            ffmpeg_proc.stdin.close()
    except Exception as e:
        logger.warning(f"Error closing stdin: {e}")

# Check for errors after FFmpeg finishes
ffmpeg_proc.wait()
if ffmpeg_proc.returncode != 0:
    raise RuntimeError(f"FFmpeg failed: {stderr_text}")
if write_error:
    raise RuntimeError(f"Frame writing failed: {write_error}")
```

---

## Progress Bar for Async Operations

### The Challenge

Modal calls are blocking from the caller's perspective - we can't get real-time progress from inside the Modal function. Solution: simulate progress based on benchmarked timings.

### Benchmark-Based Progress Simulation

From production benchmarks:
- **Startup time**: ~5 seconds (container cold start)
- **Execution time**: Varies with video length (5-15s typical)

### Implementation Pattern

Run a progress update task concurrently with the Modal call:

```python
async def render_overlay(request):
    # ... setup code ...

    async def update_progress_during_modal():
        """Update progress while Modal is processing."""
        import time
        start_time = time.time()

        STARTUP_DURATION = 5.0  # seconds (from benchmarks)
        MAX_PROCESSING_TIME = 30.0  # estimate for processing phase

        while True:
            elapsed = time.time() - start_time

            if elapsed < STARTUP_DURATION:
                # Startup phase: 5% -> 30% over 5 seconds
                progress = 5 + int((elapsed / STARTUP_DURATION) * 25)
                message = "Starting cloud GPU..."
            else:
                # Processing phase: 30% -> 90%
                processing_elapsed = elapsed - STARTUP_DURATION
                progress_fraction = min(processing_elapsed / MAX_PROCESSING_TIME, 0.95)
                progress = 30 + int(progress_fraction * 60)
                progress = min(progress, 90)  # Cap at 90%
                message = "Processing video on GPU..."

            await manager.send_progress(export_id, {
                "progress": progress,
                "message": message,
                "status": "processing"
            })

            await asyncio.sleep(0.5)  # Update every 500ms

    # Run Modal call with progress updates
    progress_task = asyncio.create_task(update_progress_during_modal())

    try:
        result = await call_modal_overlay(...)
    finally:
        progress_task.cancel()
        try:
            await progress_task
        except asyncio.CancelledError:
            pass

    # Update to 95% after Modal completes
    await manager.send_progress(export_id, {
        "progress": 95,
        "message": "Saving to library..."
    })

    # ... save to database ...

    # Final 100%
    await manager.send_progress(export_id, {
        "progress": 100,
        "message": "Export complete!",
        "status": "complete"
    })
```

### Progress Phases

| Phase | Progress | Duration | Message |
|-------|----------|----------|---------|
| Init | 5% | Instant | "Sending to cloud GPU..." |
| Startup | 5-30% | ~5s | "Starting cloud GPU..." |
| Processing | 30-90% | Varies | "Processing video on GPU..." |
| Saving | 95% | <1s | "Saving to library..." |
| Complete | 100% | - | "Export complete!" |

---

## Deployment & CLI Issues

### Windows Encoding Problems

The Modal CLI outputs Unicode characters (✓, 🔨, 🎉) that Windows console can't display, causing `'charmap' codec can't encode character` errors.

**Solution** - Deploy via Python subprocess with proper encoding:

```python
import subprocess
import os

env = os.environ.copy()
env['PYTHONIOENCODING'] = 'utf-8'
env['PYTHONUTF8'] = '1'

result = subprocess.run(
    [r'C:\path\to\modal.exe', 'deploy', 'video_processing.py'],
    capture_output=True,
    env=env
)

# Write output to file to avoid print encoding issues
with open('deploy_result.txt', 'w', encoding='utf-8', errors='replace') as f:
    stdout = result.stdout.decode('utf-8', errors='replace')
    stderr = result.stderr.decode('utf-8', errors='replace')
    f.write(f"STDOUT:\n{stdout}\n\nSTDERR:\n{stderr}\n")
```

### Verifying Deployment

After deployment, verify functions are accessible:

```python
import modal

MODAL_APP_NAME = 'reel-ballers-video'

try:
    fn = modal.Function.from_name(MODAL_APP_NAME, 'render_overlay')
    print("render_overlay: OK")
except Exception as e:
    print(f"render_overlay: FAILED - {e}")
```

---

## Function Naming

### Avoid Generic Names

**Wrong**: `process_video` (ambiguous - what kind of processing?)

**Right**:
- `render_overlay` - Apply highlight overlays
- `process_framing` - Crop, trim, speed changes
- `apply_upscale` - AI upscaling (future)

### Separate Functions for Different Operations

Each operation type should be a separate Modal function. This allows:
1. Different GPU/resource configurations per function
2. Clearer logging and debugging
3. Independent scaling
4. Better cost tracking

```python
@app.function(image=image, gpu="T4", timeout=600)
def render_overlay(...):
    """Overlay processing - T4 GPU is sufficient."""
    pass

@app.function(image=image, gpu="A10G", timeout=900)
def apply_upscale(...):
    """AI upscaling - needs more GPU memory."""
    pass
```

---

## Cost-Optimized Parallel Processing

### The Problem

Parallel processing has overhead that can make it MORE expensive than sequential:
- Each container has ~5-7s startup cost
- Orchestrator (if GPU) wastes GPU time while waiting for workers
- More containers = more startup overhead

### Cost Model

With a **CPU-only orchestrator** (no GPU while coordinating):

| Config | Base Cost | Per-Frame Cost | Time Formula |
|--------|-----------|----------------|--------------|
| 1 GPU | 5 GPU-sec | F/60 | 5 + F/60 sec |
| 2 GPUs | 14 GPU-sec | F/60 | 12 + F/120 sec |
| 4 GPUs | 28 GPU-sec | F/60 | 12 + F/240 sec |
| 8 GPUs | 56 GPU-sec | F/60 | 12 + F/480 sec |

### Time Break-Even Points

- 1 GPU vs 2 GPUs: ~28 seconds (below this, 1 GPU is faster)
- 1 GPU vs 4 GPUs: ~19 seconds
- 1 GPU vs 8 GPUs: ~16 seconds

### Cost-Optimized Thresholds

```python
GPU_CONFIG_THRESHOLDS = [
    (30, 1, "sequential"),       # 0-30s: 1 GPU - sequential is BOTH faster AND cheaper
    (90, 2, "2-gpu-parallel"),   # 30-90s: 2 GPUs - best cost/time ratio
    (180, 4, "4-gpu-parallel"),  # 90-180s: 4 GPUs - worth extra cost for time savings
    (float('inf'), 8, "8-gpu-parallel"),  # 180s+: 8 GPUs - max parallelism
]
```

### Key Optimization: CPU-Only Orchestrator

The orchestrator function only does I/O (download, coordinate, concatenate, upload).
Making it CPU-only saves ~40% on parallel processing costs:

```python
@app.function(
    image=image,
    # NO GPU - orchestrator only does I/O and coordination
    timeout=600,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def render_overlay_parallel(...):
    # Downloads input, calls .map() on GPU workers, concatenates output
    pass
```

### Example Cost Comparison (60s video, 1800 frames)

| Config | Wall Time | GPU Cost | Cost/Time Ratio |
|--------|-----------|----------|-----------------|
| 1 GPU | 35s | 35 GPU-sec | 1.0 GPU-sec/sec |
| 2 GPUs | 27s | 44 GPU-sec | 1.1 GPU-sec/sec saved |
| 4 GPUs | 19.5s | 58 GPU-sec | 1.5 GPU-sec/sec saved |
| 8 GPUs | 15.75s | 86 GPU-sec | 2.6 GPU-sec/sec saved |

**Recommendation**: For cost-sensitive workloads, use 2 GPUs (best ratio).
For time-sensitive workloads, use more GPUs.

---

## Quick Reference

### Modal Client Template

```python
# modal_client.py
import os
import asyncio
import logging

logger = logging.getLogger(__name__)

_modal_enabled = os.environ.get("MODAL_ENABLED", "false").lower() == "true"
MODAL_APP_NAME = "your-app-name"

_cached_fn = None

def modal_enabled() -> bool:
    return _modal_enabled

def _get_function():
    global _cached_fn
    if _cached_fn is not None:
        return _cached_fn

    import modal
    _cached_fn = modal.Function.from_name(MODAL_APP_NAME, "function_name")
    return _cached_fn

async def call_modal_function(**kwargs) -> dict:
    if not _modal_enabled:
        raise RuntimeError("Modal is not enabled")

    fn = _get_function()

    try:
        result = await asyncio.to_thread(fn.remote, **kwargs)
        return result
    except Exception as e:
        logger.error(f"Modal call failed: {e}")
        return {"status": "error", "error": str(e)}
```

### FFmpeg Pipe Template

```python
def process_video_with_ffmpeg(input_path, output_path, ...):
    import subprocess
    import cv2

    cap = cv2.VideoCapture(input_path)
    # ... get video properties ...

    ffmpeg_cmd = ["ffmpeg", "-y", "-f", "rawvideo", ...]
    ffmpeg_proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    write_error = None

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Process frame...

            try:
                if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
                    ffmpeg_proc.stdin.write(frame.tobytes())
                    ffmpeg_proc.stdin.flush()
                else:
                    write_error = "stdin closed"
                    break
            except (BrokenPipeError, OSError) as e:
                write_error = str(e)
                break
    finally:
        cap.release()
        try:
            if ffmpeg_proc.stdin and not ffmpeg_proc.stdin.closed:
                ffmpeg_proc.stdin.close()
        except:
            pass

    ffmpeg_proc.wait()  # NOT communicate()!

    stderr = ffmpeg_proc.stderr.read().decode() if ffmpeg_proc.stderr else ""

    if ffmpeg_proc.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {stderr[:500]}")
    if write_error:
        raise RuntimeError(f"Write failed: {write_error}")
```

---

## Video Codec Compatibility

### The Problem

Videos encoded without proper flags may play in browsers (which have broad codec support) but fail in desktop players like Windows Media Player.

### Required FFmpeg Flags

**CRITICAL**: Always include these flags for maximum compatibility:

```python
ffmpeg_cmd = [
    "ffmpeg", "-y",
    "-f", "rawvideo",
    "-pix_fmt", "bgr24",  # OpenCV outputs BGR
    "-s", f"{width}x{height}",
    "-r", str(fps),
    "-i", "pipe:0",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",      # REQUIRED: Most compatible pixel format
    "-preset", "fast",
    "-crf", "23",
    "-movflags", "+faststart",  # RECOMMENDED: Moves moov atom to start
    "-c:a", "aac",
    "-b:a", "192k",
    output_path,
]
```

| Flag | Purpose | Without It |
|------|---------|------------|
| `-pix_fmt yuv420p` | Standard pixel format | WMP and many players show black screen |
| `-movflags +faststart` | Moov atom at file start | Slow loading, streaming issues |

### Why `-pix_fmt yuv420p` is Critical

1. OpenCV outputs frames in BGR24 format
2. Without explicit output format, FFmpeg may choose yuv444p or other formats
3. Many players only support yuv420p for H.264
4. Browser video elements are more tolerant but desktop players are not

---

## Real-World Cost Analysis

### Observed Costs (January 2025)

From production usage with T4 GPUs:

| Calls | Total Cost | Per Call | Avg Execution | Video Duration |
|-------|------------|----------|---------------|----------------|
| 5 | $0.07 | $0.014 | ~10s | 11-12s |

### Cost Breakdown

Modal T4 GPU pricing: ~$0.000463/GPU-second (~$1.67/GPU-hour)

Typical call breakdown:
- **Startup**: 2-6 seconds (container cold/warm start)
- **Execution**: 5-15 seconds (depends on video length)
- **Total**: ~10-15 seconds per call

Cost per 10s video: ~$0.01-0.02 (includes overhead)

### Cost Optimization Tips

1. **Use sequential for short videos (<30s)**: Avoids parallel startup overhead
2. **Cache container warm**: Frequent calls keep containers warm (2.7s vs 6.5s startup)
3. **CPU orchestrator**: Don't use GPU for coordination (saves ~40%)
4. **Right-size GPU config**: 2 GPUs has best cost/time ratio for 30-90s videos

---

## YOLO Detection on Modal

### Why Move Detection to Modal

The FastAPI backend should be CPU-only for scalability. YOLO detection uses GPU, so it must run on Modal.

### Available Detection Functions

```python
# detect_players_modal - Single frame player detection
fn = modal.Function.from_name("reel-ballers-video", "detect_players_modal")
result = fn.remote(
    user_id="user123",
    input_key="videos/gameplay.mp4",  # R2 key (relative to user folder)
    frame_number=100,
    confidence_threshold=0.5,
)
# Returns: {"status": "success", "detections": [...], "video_width": 1920, "video_height": 1080}

# detect_ball_modal - Multi-frame ball detection
fn = modal.Function.from_name("reel-ballers-video", "detect_ball_modal")
result = fn.remote(
    user_id="user123",
    input_key="videos/gameplay.mp4",
    start_frame=0,
    end_frame=300,
    confidence_threshold=0.3,
)
# Returns: {"status": "success", "ball_positions": [...], "video_width": 1920, "video_height": 1080}
```

### Detection Request Models

For the FastAPI endpoints, include R2 video location:

```python
# PlayerDetectionRequest
{
    "user_id": "a",                    # R2 user folder
    "input_key": "raw_clips/video.mp4", # R2 key
    "frame_number": 100,
    "confidence_threshold": 0.5
}

# BallDetectionRequest
{
    "user_id": "a",
    "input_key": "raw_clips/video.mp4",
    "start_frame": 0,
    "end_frame": 300,
    "confidence_threshold": 0.3
}
```

### Separate Image for YOLO

YOLO detection requires additional dependencies (ultralytics, torch). Use a separate image:

```python
yolo_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")
    .pip_install(
        "boto3",
        "opencv-python-headless",
        "numpy",
        "ultralytics",
        "torch",
        "torchvision",
    )
)

@app.function(image=yolo_image, gpu="T4", timeout=120)
def detect_players_modal(...):
    pass
```

### Model Caching

YOLO model is cached per-container to avoid re-downloading:

```python
_yolo_model = None

def _get_yolo_model():
    global _yolo_model
    if _yolo_model is None:
        from ultralytics import YOLO
        _yolo_model = YOLO("yolov8x.pt")  # Auto-downloads if needed
    return _yolo_model
```

### Expected Detection Costs

Player detection (single frame): ~$0.005-0.01 (quick operation)
Ball detection (100 frames): ~$0.02-0.05 (depends on frame count)

First call has cold start overhead (~5-7s), subsequent calls are faster (~2-3s startup).
