# Task: Real Modal Progress Tracking

## Status: Not Started

## Problem

Currently, Modal progress is **simulated** using time-based estimation:
- We estimate total time based on frame count (1.1s/frame for Real-ESRGAN)
- Progress is calculated as `elapsed_time / estimated_time`
- This means progress can be inaccurate if actual processing differs from estimate

Real test data (225 frames, Framing AI export):
- Estimated: 257s (with updated formula)
- Actual: 247s
- Frontend summary: `modal_download:20.1s modal_init:10.0s modal_upscale:122.5s modal_encode:28.1s modal_upload:66.2s`

## Goal

Get **real progress** from Modal functions and use phase weights to calculate accurate overall progress.

## Current Architecture

### Backend Progress Flow
```
modal_client.py (simulated progress)
    ↓
framing.py modal_progress_callback(progress, message, phase)
    ↓
websocket.py broadcast_progress(export_id, data)
    ↓
WebSocket → Frontend
```

### Why Modal Doesn't Yield Progress Currently

Modal functions use `spawn()` + `get()` pattern:
```python
# modal_client.py:214-247
modal_call = await loop.run_in_executor(None, spawn_modal_job)
result_future = asyncio.create_task(wait_for_result())

# This blocks until completion - no intermediate progress
while not result_future.done():
    # Simulated progress based on elapsed time
    progress = elapsed / estimated_time
    await progress_callback(progress, phase_msg, current_phase)
    await asyncio.sleep(2)
```

## Implementation Options

### Option A: Modal Generator Functions (Recommended)

Modal supports generator functions that can yield progress:

```python
# video_processing.py (Modal side)
@app.function(gpu="T4")
def process_framing_ai_with_progress(...):
    yield {"phase": "download", "progress": 0}
    # download video...
    yield {"phase": "download", "progress": 100}

    yield {"phase": "upscale", "progress": 0, "frame": 0, "total_frames": N}
    for i, frame in enumerate(frames):
        result = upscale_frame(frame)
        if i % 10 == 0:  # Every 10 frames
            yield {"phase": "upscale", "progress": i/N*100, "frame": i}

    yield {"phase": "encode", "progress": 0}
    # encode video...
    yield {"phase": "encode", "progress": 100}

    return {"status": "success", "output_key": output_key}
```

```python
# modal_client.py (backend side)
async def call_modal_framing_ai(...):
    for update in process_framing_ai.remote_gen(...):
        if isinstance(update, dict) and "phase" in update:
            # Real progress from Modal
            await progress_callback(
                calculate_overall_progress(update),
                update.get("message", "Processing..."),
                update["phase"]
            )
        else:
            # Final result
            return update
```

### Option B: Modal Webhooks/Callbacks

Modal can call back to our backend with progress updates. More complex setup.

### Option C: Polling Modal Logs

Parse Modal function logs for progress. Fragile and not recommended.

## Phase Weights (Based on Real Data)

From the 225-frame test:
| Phase | Duration | % of Total |
|-------|----------|------------|
| modal_download | 20.1s | 8% |
| modal_init | 10.0s | 4% |
| modal_upscale | 122.5s | 50% |
| modal_encode | 28.1s | 11% |
| modal_upload | 66.2s | 27% |

Suggested progress ranges for Framing AI:
```python
FRAMING_AI_PHASE_WEIGHTS = {
    "modal_download": (0, 8),      # 0-8%
    "modal_init": (8, 12),         # 8-12%
    "modal_upscale": (12, 62),     # 12-62% (this is where frame-by-frame helps)
    "modal_encode": (62, 73),      # 62-73%
    "modal_upload": (73, 100),     # 73-100%
}

def calculate_overall_progress(phase: str, phase_progress: float) -> float:
    """Convert phase + phase_progress to overall progress."""
    start, end = FRAMING_AI_PHASE_WEIGHTS[phase]
    return start + (phase_progress / 100) * (end - start)
```

## Modal Functions Inventory

All Modal functions in `modal_client.py` and their progress strategies:

### 1. `call_modal_framing_ai` (Framing Export - FAST mode)

**Used by:** `src/backend/app/routers/export/framing.py`

**Current phases:** modal_download → modal_init → modal_upscale → modal_encode → modal_upload

**Real progress strategy:**
- **modal_download**: Yield progress based on bytes downloaded vs total size
- **modal_init**: Single yield when model loaded (short phase, no granularity needed)
- **modal_upscale**: Yield every N frames with `{frame: i, total: N}` - **most valuable**
- **modal_encode**: FFmpeg doesn't easily yield progress; estimate by time or keep simulated
- **modal_upload**: Yield progress based on bytes uploaded vs total size

**Phase weights (from 225-frame test):**
```python
FRAMING_AI_WEIGHTS = {
    "modal_download": (0, 8),
    "modal_init": (8, 12),
    "modal_upscale": (12, 62),   # 50% of time - frame-by-frame helps here
    "modal_encode": (62, 73),
    "modal_upload": (73, 100),
}
```

---

### 2. `call_modal_multi_clip` (Multi-Clip Export)

**Used by:** `src/backend/app/routers/export/multi_clip.py`

**Current phases:** modal_download → modal_init → modal_upscale → modal_encode → modal_concat → modal_upload

**Real progress strategy:**
- **modal_download**: Yield per-clip download progress
- **modal_init**: Single yield when model loaded
- **modal_upscale**: Yield per-clip and per-frame: `{clip: i, total_clips: N, frame: j, clip_frames: M}`
- **modal_encode**: Per-clip encode progress
- **modal_concat**: Usually fast, single yield
- **modal_upload**: Bytes uploaded vs total

**Phase weights (estimated for 3 clips):**
```python
MULTI_CLIP_WEIGHTS = {
    "modal_download": (0, 10),
    "modal_init": (10, 12),
    "modal_upscale": (12, 55),   # Per-clip × per-frame
    "modal_encode": (55, 70),
    "modal_concat": (70, 80),
    "modal_upload": (80, 100),
}
```

**Progress message format:** `"Processing clip 2/3: frame 150/300"`

---

### 3. `call_modal_overlay` (Overlay Export)

**Used by:** `src/backend/app/routers/export/overlay.py`

**Current phases:** modal_download → modal_overlay → modal_process → modal_encode → modal_upload

**Real progress strategy:**
- **modal_download**: Bytes downloaded
- **modal_overlay/process**: Frame-by-frame overlay application `{frame: i, total: N}`
- **modal_encode**: Time-based estimate (FFmpeg)
- **modal_upload**: Bytes uploaded

**Phase weights (estimated):**
```python
OVERLAY_WEIGHTS = {
    "modal_download": (0, 10),
    "modal_overlay": (10, 20),
    "modal_process": (20, 70),   # Frame processing
    "modal_encode": (70, 85),
    "modal_upload": (85, 100),
}
```

---

### 4. `call_modal_annotate_compilation` (Annotate Compilation Export)

**Used by:** `src/backend/app/routers/annotate.py`

**Current phases:** modal_download → modal_process → modal_merge → modal_upload

**Real progress strategy:**
- **modal_download**: Single large video download, yield bytes
- **modal_process**: Per-clip extraction `{clip: i, total_clips: N}`
- **modal_merge**: FFmpeg concat, time-based
- **modal_upload**: Bytes uploaded

**Phase weights (estimated for 10 clips):**
```python
ANNOTATE_COMPILATION_WEIGHTS = {
    "modal_download": (0, 15),
    "modal_process": (15, 70),   # Per-clip progress
    "modal_merge": (70, 85),
    "modal_upload": (85, 100),
}
```

---

### 5. `call_modal_detect_players` (Player Detection)

**Used by:** `src/backend/app/routers/framing.py` (single frame detection)

**Progress strategy:** **None needed** - single frame operation, completes in <2s

---

### 6. `call_modal_extract_clip` (Clip Extraction)

**Used by:** `src/backend/app/routers/annotate.py`

**Progress strategy:** **None needed** - CPU-only FFmpeg copy, completes in <5s

---

## Progress Calculation Helper

Create a shared utility for converting phase progress to overall progress:

```python
# src/backend/app/services/progress_calculator.py

PHASE_WEIGHTS = {
    "framing_ai": {
        "modal_download": (0, 8),
        "modal_init": (8, 12),
        "modal_upscale": (12, 62),
        "modal_encode": (62, 73),
        "modal_upload": (73, 100),
    },
    "multi_clip": {
        "modal_download": (0, 10),
        "modal_init": (10, 12),
        "modal_upscale": (12, 55),
        "modal_encode": (55, 70),
        "modal_concat": (70, 80),
        "modal_upload": (80, 100),
    },
    "overlay": {
        "modal_download": (0, 10),
        "modal_overlay": (10, 20),
        "modal_process": (20, 70),
        "modal_encode": (70, 85),
        "modal_upload": (85, 100),
    },
    "annotate_compilation": {
        "modal_download": (0, 15),
        "modal_process": (15, 70),
        "modal_merge": (70, 85),
        "modal_upload": (85, 100),
    },
}

def calculate_overall_progress(
    export_type: str,
    phase: str,
    phase_progress: float  # 0-100 within the phase
) -> float:
    """Convert phase + phase_progress to overall 0-100 progress."""
    weights = PHASE_WEIGHTS.get(export_type, {})
    if phase not in weights:
        return phase_progress  # Fallback

    start, end = weights[phase]
    return start + (phase_progress / 100) * (end - start)
```

---

## Files to Modify

1. **src/backend/app/modal_functions/video_processing.py**
   - Convert `process_framing_ai` to generator that yields progress
   - Add frame-by-frame progress during upscaling loop

2. **src/backend/app/services/modal_client.py**
   - Use `remote_gen()` instead of `spawn()` + `get()`
   - Parse yielded progress updates
   - Apply phase weights to calculate overall progress

3. **src/backend/app/routers/export/framing.py**
   - Update progress callback to handle real progress data

## Benchmarking: Gathering Phase Weight Data

Before implementing real progress, we need accurate phase weights from real exports. Here's how to gather that data:

### Step 1: Add Timing Instrumentation to Modal Functions

Add detailed timing logs to each Modal function in `video_processing.py`:

```python
# src/backend/app/modal_functions/video_processing.py

import time
import json

@app.function(gpu="T4")
def process_framing_ai(...):
    timings = {"job_id": job_id, "frames": 0}
    job_start = time.time()

    # Download phase
    t0 = time.time()
    download_video(...)
    timings["download"] = time.time() - t0

    # Init phase
    t0 = time.time()
    model = load_realesrgan_model()
    timings["init"] = time.time() - t0

    # Upscale phase
    t0 = time.time()
    for i, frame in enumerate(frames):
        upscaled = model.enhance(frame)
        timings["frames"] = i + 1
    timings["upscale"] = time.time() - t0

    # Encode phase
    t0 = time.time()
    encode_video(...)
    timings["encode"] = time.time() - t0

    # Upload phase
    t0 = time.time()
    upload_to_r2(...)
    timings["upload"] = time.time() - t0

    timings["total"] = time.time() - job_start

    # Log as JSON for easy parsing
    print(f"BENCHMARK_DATA: {json.dumps(timings)}")

    return {"status": "success", ...}
```

### Step 2: Collect Benchmark Logs from Modal

```bash
# View recent Modal logs
modal app logs reel-ballers-video --since 1h

# Filter for benchmark data and save to file
modal app logs reel-ballers-video --since 24h | grep "BENCHMARK_DATA" > benchmarks.jsonl

# Or use Modal dashboard: https://modal.com/apps
```

### Step 3: Analyze Benchmark Data

Create a script to analyze the collected data:

```python
# scripts/analyze_modal_benchmarks.py

import json
import sys
from collections import defaultdict

def analyze_benchmarks(filepath):
    """Analyze Modal benchmark data to determine phase weights."""

    data_by_type = defaultdict(list)

    with open(filepath) as f:
        for line in f:
            if "BENCHMARK_DATA:" in line:
                json_str = line.split("BENCHMARK_DATA:")[1].strip()
                data = json.loads(json_str)
                export_type = data.get("type", "framing_ai")
                data_by_type[export_type].append(data)

    for export_type, records in data_by_type.items():
        print(f"\n=== {export_type} ({len(records)} samples) ===")

        # Calculate average percentages
        phases = ["download", "init", "upscale", "encode", "upload"]
        avg_pct = {}

        for phase in phases:
            times = [r.get(phase, 0) for r in records]
            totals = [r.get("total", 1) for r in records]
            pcts = [t/total*100 for t, total in zip(times, totals)]
            avg_pct[phase] = sum(pcts) / len(pcts) if pcts else 0

        # Print results
        cumulative = 0
        print("\nPhase weights (for PHASE_WEIGHTS dict):")
        print("{")
        for phase in phases:
            pct = avg_pct.get(phase, 0)
            start = round(cumulative)
            end = round(cumulative + pct)
            print(f'    "{phase}": ({start}, {end}),  # {pct:.1f}%')
            cumulative += pct
        print("}")

        # Per-frame stats for upscale phase
        frame_counts = [r.get("frames", 0) for r in records]
        upscale_times = [r.get("upscale", 0) for r in records]
        if frame_counts and upscale_times:
            per_frame = [t/f for t, f in zip(upscale_times, frame_counts) if f > 0]
            if per_frame:
                print(f"\nPer-frame upscale time: {sum(per_frame)/len(per_frame):.3f}s avg")

if __name__ == "__main__":
    analyze_benchmarks(sys.argv[1] if len(sys.argv) > 1 else "benchmarks.jsonl")
```

### Step 4: Run Benchmark Exports

Create test exports with varying parameters to get representative data:

```bash
# Test matrix for Framing AI:
# - Short video (5s, ~150 frames)
# - Medium video (15s, ~450 frames)
# - Long video (60s, ~1800 frames)
# - Different resolutions (720p input, 1080p input)

# Log the benchmark command
echo "Running benchmark suite at $(date)" >> benchmark_log.txt

# Trigger exports via API or frontend, then collect logs
```

### Step 5: Update Phase Weights

After collecting sufficient data (10+ samples per export type), update the weights:

```python
# src/backend/app/services/progress_calculator.py

# Updated based on benchmark data collected on YYYY-MM-DD
# Sample sizes: framing_ai=25, multi_clip=10, overlay=15
PHASE_WEIGHTS = {
    "framing_ai": {
        # From analyze_modal_benchmarks.py output
        "modal_download": (0, 8),
        "modal_init": (8, 12),
        "modal_upscale": (12, 62),
        "modal_encode": (62, 73),
        "modal_upload": (73, 100),
    },
    # ... other export types
}
```

### Benchmark Data We Already Have

**Test 1: Cold GPU Start (225 frames, 7.5s video)**
```
Backend: 247s total
Frontend timing: 251.9s total
- modal_download: 20.1s (8.0%)
- modal_init: 10.0s (4.0%)
- modal_upscale: 122.5s (48.6%)
- modal_encode: 28.1s (11.2%)
- modal_upload: 66.2s (26.3%)

Per-frame: 247s / 225 = 1.1s/frame total
```

**Test 2: Warm GPU (187 frames, 6.25s trimmed video)**
```
Backend: 158.4s total
Frontend timing: 162.5s total
- modal_download: 26.0s (16.4%)
- modal_init: 14.0s (8.9%)
- modal_upscale: 118.3s (74.7%)
- (encode/upload phases not captured - job finished early)

Per-frame: 158s / 187 = 0.85s/frame total
```

**Key Insights:**
1. Cold vs warm GPU makes a big difference: 1.1s vs 0.85s per frame
2. Upload phase is significant (~27% of total) but was under-allocated in progress
3. Frame count estimation must account for trim AND speed changes
4. Using 1.0s/frame as balanced estimate (slightly pessimistic = better UX)

**Note:** Frontend phases are measured from WebSocket message timing. Modal-side instrumentation would be more accurate.

### Factors That Affect Phase Weights

Document these when collecting benchmarks:

1. **Video resolution**: Higher res = longer download/upload, longer upscale
2. **Frame count**: More frames = longer upscale (linear), slightly longer encode
3. **Network speed**: Affects download/upload phases
4. **GPU cold start**: First call after idle adds ~30s to init
5. **R2 region**: Latency to/from Cloudflare R2
6. **Codec**: H.264 vs H.265 affects encode time

---

## Testing Plan

1. Add logging to compare estimated vs actual phase durations
2. Test with various video lengths (5s, 30s, 60s)
3. Verify progress bar moves smoothly (no jumps or stalls)
4. Compare user experience: simulated vs real progress

## Considerations

- **Cold start**: First Modal call has ~30s cold start. Should show "Starting GPU..." phase
- **Network latency**: Progress updates add network overhead. Batch updates (every 10 frames)
- **Error handling**: If generator fails mid-stream, need graceful recovery
- **Backwards compatibility**: Keep simulated progress as fallback

## Fixes Already Implemented (Progress Bar Improvements Branch)

These fixes improved simulated progress accuracy without real Modal progress:

1. **Frame count calculation** (`highlight_transform.py`, `framing.py`)
   - Added `get_output_duration()` to calculate actual output duration
   - Accounts for trim (trim_start/trim_end) AND speed changes (0.5x = 2x frames)
   - Previously used source video duration, not trimmed duration

2. **Phase thresholds** (`modal_client.py`)
   - Adjusted to match actual benchmark data
   - Old: download=10%, init=5%, upscale=65%, encode=15%, upload=5%
   - New: download=8%, init=4%, upscale=50%, encode=11%, upload=27%
   - Upload was severely under-allocated (5% vs actual 27%)

3. **Time estimate formula** (`modal_client.py`)
   - Changed from 1.1s/frame + 10s overhead to 1.0s/frame total
   - Balances cold start (1.1s) vs warm GPU (0.85s)

These fixes make simulated progress feel more linear. Real Modal progress would further improve accuracy.

## Related Files

- `src/backend/app/services/modal_client.py` - Current simulated progress implementation
- `src/backend/app/modal_functions/video_processing.py` - Modal GPU functions
- `src/frontend/src/components/ExportButton.jsx` - Frontend phase tracking
- `src/frontend/src/services/ExportWebSocketManager.js` - WebSocket progress handling

## References

- Modal generator functions: https://modal.com/docs/guide/generators
- Current progress implementation: modal_client.py lines 249-288
