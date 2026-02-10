# Task 18: Modal GPU Cost Optimization

## Overview
Optimize Modal GPU usage across all endpoints to balance cost vs processing time. Currently only the overlay endpoint uses parallelization - we need to extend this to `process_framing_ai` (which is 25x slower) and tune thresholds based on real-world data.

## Owner
**Claude** - Analysis and implementation task

## Prerequisites
- Stable build with all Modal functions working
- Task 06-09 complete (Modal integration)
- Real usage data from production (or test runs)

## Testability
**After this task**: Have data-driven GPU thresholds that minimize cost while maintaining acceptable processing times.

---

## Current State Analysis

### Parallelization Status

| Function | Parallelizable? | Current State | Notes |
|----------|----------------|---------------|-------|
| `render_overlay` | Yes | Has `GPU_CONFIG_THRESHOLDS` | Frame-by-frame Python/OpenCV |
| `render_overlay_parallel` | - | Orchestrator using `.map()` | Coordinates GPU workers |
| `process_framing_ai` | **Yes** | **No parallelization** | Frame-by-frame Real-ESRGAN (25x slower!) |
| `process_framing` | No | N/A | FFmpeg handles own threading |
| `detect_players_modal` | N/A | N/A | Single frame per request |

### Current Overlay Thresholds

```python
GPU_CONFIG_THRESHOLDS = {
    # video_duration -> (num_chunks, description)
    30: (1, "sequential"),      # 0-30s: 1 GPU
    90: (2, "2-gpu-parallel"),  # 30-90s: 2 GPUs
    180: (4, "4-gpu-parallel"), # 90-180s: 4 GPUs
    float('inf'): (8, "8-gpu-parallel"),  # 180s+: 8 GPUs
}
```

### The Problem with Framing AI

If `process_framing_ai` is 25x slower than overlay:
- A 30s video in overlay takes ~30s
- A 30s video in framing_ai takes ~750s (12.5 minutes!)

This means the current "no parallelization" approach for framing_ai is **extremely suboptimal**:
- Fixed startup overhead (R2 download, model load) is tiny compared to 12+ minutes of processing
- Even very short videos (3-5s) would benefit from parallelization

---

## Phase 1: Data Collection Experiments

### Experiment 1: Baseline Processing Times

**Goal**: Measure actual processing times per frame for each endpoint.

**Test Videos**:
- Short: 5 seconds @ 30fps = 150 frames
- Medium: 30 seconds @ 30fps = 900 frames
- Long: 120 seconds @ 30fps = 3600 frames

**Metrics to Collect**:

| Metric | How to Measure |
|--------|----------------|
| `overlay_ms_per_frame` | Total time / frame count |
| `framing_ai_ms_per_frame` | Total time / frame count |
| `framing_ffmpeg_total_time` | End-to-end time (FFmpeg is batched) |
| `startup_overhead_ms` | Time from function start to first frame processed |
| `r2_download_time_ms` | Time to download input video |
| `r2_upload_time_ms` | Time to upload output video |
| `model_load_time_ms` | Time to load Real-ESRGAN/YOLO (first call only) |

**Test Script**:

```python
# Add to video_processing.py for profiling
import time

def profile_overlay_processing(video_path, num_frames):
    """Profile overlay processing per frame."""
    times = []
    for frame_idx in range(num_frames):
        start = time.perf_counter()
        # ... process frame ...
        times.append(time.perf_counter() - start)
    return {
        "avg_ms": sum(times) / len(times) * 1000,
        "min_ms": min(times) * 1000,
        "max_ms": max(times) * 1000,
        "total_ms": sum(times) * 1000,
    }
```

**Expected Results**:

| Endpoint | Expected ms/frame | Bottleneck |
|----------|-------------------|------------|
| Overlay | ~10-30ms | OpenCV pixel operations |
| Framing AI | ~250-750ms | Real-ESRGAN neural network |
| Framing FFmpeg | N/A (batched) | FFmpeg filter chain |

---

### Experiment 2: Parallel Overhead Measurement

**Goal**: Measure the fixed overhead of parallelization.

**Components of Overhead**:
1. CPU orchestrator container startup
2. Splitting video into chunk metadata
3. Spawning N GPU containers via `.map()`
4. Each GPU container: R2 download, seek to chunk start
5. Concatenation of chunk outputs
6. Cleanup of temporary R2 files

**Test**: Run same video with 1, 2, 4, 8 chunks and measure:

| Metric | Description |
|--------|-------------|
| `orchestrator_startup_ms` | Time before `.map()` is called |
| `map_dispatch_ms` | Time for `.map()` to return all results |
| `chunk_download_overhead_ms` | Each chunk re-downloads full video and seeks |
| `concatenation_ms` | Time to download chunks + FFmpeg concat |
| `cleanup_ms` | Time to delete temp R2 files |

**Expected Results**:

```
Overhead breakdown (estimated):
- Orchestrator startup: ~2-5s
- Per-chunk download: ~1-3s each (parallel, so doesn't stack)
- Concatenation: ~5-15s depending on chunk count
- Cleanup: ~1-2s

Total fixed overhead: ~10-25s regardless of video length
```

---

### Experiment 3: Break-Even Analysis

**Goal**: Find the video duration where parallelization saves time.

**Formula**:
```
Sequential time = startup + (frames * ms_per_frame)
Parallel time = parallel_overhead + (frames / N) * ms_per_frame + concat_time

Break-even when: Sequential time = Parallel time
```

**For Overlay (current)**:
- ms_per_frame ≈ 20ms
- parallel_overhead ≈ 15s
- For 2 GPUs: break-even at ~30s video ✓ (matches current threshold)

**For Framing AI (proposed)**:
- ms_per_frame ≈ 500ms (25x slower)
- parallel_overhead ≈ 15s
- For 2 GPUs: break-even at ~1.2s video!
- For 4 GPUs: break-even at ~0.8s video!

**Conclusion**: Even 2-3 second videos should use parallelization for framing_ai.

---

## Phase 2: Implementation

### 2.1 Add Framing AI Thresholds

```python
# Separate thresholds for framing_ai due to 25x slower processing
FRAMING_AI_GPU_THRESHOLDS = {
    # video_duration -> (num_chunks, description)
    # Much lower thresholds due to slower per-frame processing
    3: (1, "sequential"),       # 0-3s: 1 GPU (overhead not worth it)
    10: (2, "2-gpu-parallel"),  # 3-10s: 2 GPUs
    20: (4, "4-gpu-parallel"),  # 10-20s: 4 GPUs
    float('inf'): (8, "8-gpu-parallel"),  # 20s+: 8 GPUs (max parallelism)
}

def get_framing_ai_gpu_config(video_duration: float) -> tuple:
    """Get optimal GPU config for framing_ai based on duration."""
    for threshold, config in sorted(FRAMING_AI_GPU_THRESHOLDS.items()):
        if video_duration < threshold:
            return config
    return (8, "8-gpu-parallel")
```

### 2.2 Create process_framing_ai_chunk Function

Similar to `process_overlay_chunk`, but for Real-ESRGAN:

```python
@app.function(
    image=upscale_image,
    gpu="T4",
    timeout=600,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai_chunk(
    job_id: str,
    chunk_index: int,
    total_chunks: int,
    user_id: str,
    input_key: str,
    output_chunk_key: str,
    start_frame: int,
    end_frame: int,
    keyframes: list,
    output_width: int,
    output_height: int,
    fps: int,
) -> dict:
    """Process a single chunk of video with Real-ESRGAN upscaling."""
    # Download full video, seek to start_frame
    # Process frames [start_frame, end_frame)
    # Upload chunk to R2
    pass
```

### 2.3 Create process_framing_ai_parallel Orchestrator

```python
@app.function(
    image=upscale_image,
    gpu=None,  # CPU only - orchestrates GPU workers
    timeout=1800,
    secrets=[modal.Secret.from_name("r2-credentials")],
)
def process_framing_ai_parallel(
    job_id: str,
    user_id: str,
    input_key: str,
    output_key: str,
    keyframes: list,
    output_width: int = 810,
    output_height: int = 1440,
    fps: int = 30,
    num_chunks: int = 4,
) -> dict:
    """Orchestrate parallel Real-ESRGAN processing."""
    # 1. Download video to get frame count
    # 2. Split into chunk configs
    # 3. Call process_framing_ai_chunk.map(chunk_configs)
    # 4. Download chunks from R2
    # 5. Concatenate with FFmpeg
    # 6. Upload final result
    # 7. Cleanup temp chunks
    pass
```

### 2.4 Update Backend Integration

Modify `call_modal_framing_ai()` in `modal_client.py`:

```python
async def call_modal_framing_ai(...) -> dict:
    """Call Modal framing AI function with automatic parallelization."""

    # Get video duration to determine GPU config
    video_duration = get_video_duration(user_id, input_key)
    num_chunks, config_name = get_framing_ai_gpu_config(video_duration)

    logger.info(f"[Modal] Framing AI: {video_duration:.1f}s video -> {config_name}")

    if num_chunks == 1:
        # Sequential processing
        fn = modal.Function.from_name("reel-ballers-video", "process_framing_ai")
        return fn.remote(...)
    else:
        # Parallel processing
        fn = modal.Function.from_name("reel-ballers-video", "process_framing_ai_parallel")
        return fn.remote(..., num_chunks=num_chunks)
```

---

## Phase 3: Cost Optimization Tuning

### Experiment 4: Cost vs Time Trade-offs

**Goal**: Find the optimal balance between cost and processing time.

**Modal Pricing (approximate)**:
- T4 GPU: ~$0.000164/second (~$0.59/hour)
- A10G GPU: ~$0.000306/second (~$1.10/hour)

**Cost Comparison for 60s video with framing_ai**:

| Config | GPUs | Est. Time | Est. Cost | Cost Efficiency |
|--------|------|-----------|-----------|-----------------|
| Sequential | 1 | ~750s | $0.12 | 100% (baseline) |
| 2-parallel | 2 | ~400s | $0.13 | 96% speed for 8% more cost |
| 4-parallel | 4 | ~220s | $0.14 | 70% speed for 17% more cost |
| 8-parallel | 8 | ~140s | $0.18 | 81% speed for 50% more cost |

**Key Insight**: Diminishing returns kick in at higher parallelism due to:
1. Fixed overhead doesn't scale down
2. Chunk boundary inefficiencies
3. Concatenation time increases

### Experiment 5: Real User Behavior Analysis

**Data to Collect** (once in production):

| Metric | Purpose |
|--------|---------|
| Video duration distribution | What's the typical video length? |
| Export wait tolerance | How long do users wait before abandoning? |
| Peak usage times | When do we need fastest processing? |
| Error rates by chunk count | Does more parallelism increase failures? |

**Adaptive Strategy**:
```python
# Consider time-of-day pricing
def get_dynamic_gpu_config(video_duration: float, peak_hours: bool) -> tuple:
    """Adjust parallelism based on time of day."""
    base_config = get_framing_ai_gpu_config(video_duration)

    if peak_hours:
        # Use more GPUs during peak to reduce wait times
        return min(base_config[0] * 2, 8), f"{base_config[1]}-peak"
    else:
        # Use fewer GPUs during off-peak to save cost
        return base_config
```

---

## Deliverables

| Item | Description | Priority |
|------|-------------|----------|
| Profiling script | Measure per-frame times for each endpoint | High |
| Baseline data | Processing times for 5s, 30s, 120s videos | High |
| Break-even analysis | Documented thresholds with justification | High |
| `FRAMING_AI_GPU_THRESHOLDS` | Tuned thresholds for framing_ai | High |
| `process_framing_ai_chunk` | Chunk processing function | High |
| `process_framing_ai_parallel` | Parallel orchestrator | High |
| Backend integration | Updated `modal_client.py` | High |
| Cost analysis spreadsheet | Expected costs at different usage levels | Medium |
| Monitoring dashboard | Track GPU usage and costs | Medium |
| Adaptive scaling logic | Time-of-day or load-based adjustments | Low |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Framing AI 30s video | < 60s processing time (vs ~750s sequential) |
| Cost per video | < 20% increase for 10x speedup |
| Error rate | No increase vs sequential |
| Modal cold start impact | < 10% of total time |

---

## Data Collection Template

```markdown
## Profiling Run: [DATE]

### Test Video: [DESCRIPTION]
- Duration: Xs
- Frames: N
- Resolution: WxH

### Overlay Processing
- Total time: Xms
- Per-frame avg: Xms
- Startup overhead: Xms

### Framing AI Processing
- Total time: Xms
- Per-frame avg: Xms
- Real-ESRGAN per-frame: Xms
- Model load time: Xms

### Parallel Overhead (N chunks)
- Orchestrator startup: Xms
- Chunk distribution: Xms
- Concatenation: Xms
- Total overhead: Xms

### Break-even Analysis
- Sequential total: Xms
- 2-GPU parallel: Xms (break-even at Xs video)
- 4-GPU parallel: Xms (break-even at Xs video)
- 8-GPU parallel: Xms (break-even at Xs video)
```

---

## Implementation Notes (2026-02-09)

### Phase 1 - Baseline Data (COMPLETE)

Used E6 benchmark results:
- **T4 GPU**: 180 frames in 122s → **1.47 fps** → **681ms per frame**
- **L4 GPU**: 180 frames in 205s → 0.88 fps → 1.14s per frame (slower, not used)

### Phase 2 - Implementation (COMPLETE)

Added parallelization to `process_framing_ai` with conservative thresholds:

**Files Changed:**
- `src/backend/app/modal_functions/video_processing.py`:
  - Added `FRAMING_AI_GPU_THRESHOLDS` config
  - Added `get_framing_ai_gpu_config()` helper
  - Added `process_framing_ai_chunk()` - GPU worker for processing a frame range
  - Added `process_framing_ai_parallel()` - CPU orchestrator using `.starmap()`

- `src/backend/app/services/modal_client.py`:
  - Added `_get_process_framing_ai_parallel_fn()` getter
  - Added threshold config (mirrors video_processing.py)
  - Updated `call_modal_framing_ai()` to route based on video duration

**Thresholds (Conservative - max 4 GPUs until data proves higher is better):**
```python
FRAMING_AI_GPU_THRESHOLDS = {
    3: (1, "sequential"),       # 0-3s: 1 GPU
    10: (2, "2-gpu-parallel"),  # 3-10s: 2 GPUs
    float('inf'): (4, "4-gpu-parallel"),  # 10s+: 4 GPUs
}
```

**Limitations:**
- Parallel processing disabled when `segment_data` is present (speed changes)
- Max 4 GPUs until we have data proving 4 beats 2

### E7 Benchmark Results (2026-02-09)

**Test Video:** 449 frames (~15s), 810x1440 output

| Config | Wall-Clock | Speedup | GPU-Seconds | Cost |
|--------|------------|---------|-------------|------|
| Sequential (1 GPU) | 310.0s | 1.00x | 310s | $0.051 |
| Parallel (2 GPUs) | 160.8s | 1.93x | 300s | $0.049 |
| **Parallel (4 GPUs)** | **87.0s** | **3.56x** | 300s | **$0.049** |
| Parallel (8 GPUs) | 103.3s | 3.00x | 707s | $0.116 |

**Key Findings:**
- **4 GPUs is optimal**: 3.56x faster at the same cost as sequential
- 8 GPUs is WORSE: slower (103s vs 87s) and 2.4x more expensive
- Per-chunk overhead (download, model load, concat) dominates with too many chunks
- Parallelization is essentially cost-neutral - same GPU-seconds, just distributed

**Final Thresholds (capped at 4 GPUs):**
```python
FRAMING_AI_GPU_THRESHOLDS = {
    3: (1, "sequential"),       # 0-3s: 1 GPU
    10: (2, "2-gpu-parallel"),  # 3-10s: 2 GPUs
    float('inf'): (4, "4-gpu-parallel"),  # 10s+: 4 GPUs (max)
}
```

### Phase 3 - Production Monitoring (TODO)

- Track real-world processing times
- Monitor for any reliability issues with parallel processing
- Consider adjusting thresholds based on actual video duration distribution

---

## Next Steps

1. ~~**Immediate**: Complete stable build (prerequisite)~~
2. ~~**Phase 1**: Run profiling experiments, collect baseline data~~
3. ~~**Phase 2**: Implement `process_framing_ai_parallel` based on data~~
4. **Phase 3**: Deploy, monitor, and tune thresholds based on production usage
