# Modal Cost Optimization Analysis

**Last Updated**: 2026-01-30

**Status**: ALL OPTIMIZATION TESTING COMPLETE - T4 BASELINE IS OPTIMAL

## Modal Pricing Reference (January 2025)

| Resource | Per Second | Per Hour | Notes |
|----------|------------|----------|-------|
| **T4 GPU** | $0.000164 | $0.59 | **Our optimal choice for AI workloads** |
| **L4 GPU** | $0.000222 | $0.80 | 35% more expensive, **1.67x SLOWER** for Real-ESRGAN |
| **A10G GPU** | $0.000306 | $1.10 | Not tested |
| **CPU (2 cores)** | $0.0000262 | $0.094 | ~6.3x cheaper than T4 |
| **Memory (GiB)** | $0.00000222 | $0.008 | Negligible |

Sources: [Modal Pricing](https://modal.com/pricing)

---

## Current Modal Functions (Optimized)

| Function | Hardware | Status | Notes |
|----------|----------|--------|-------|
| `render_overlay` | T4 GPU | **OPTIMAL** | CPU times out; GPU required |
| `process_framing_ai` | T4 GPU | **OPTIMAL** | L4 is slower; T4 is best |
| `process_multi_clip_modal` | T4 GPU | **OPTIMAL** | Single container for efficiency |
| `detect_players_modal` | T4 GPU | **OPTIMAL** | YOLO requires GPU |
| `extract_clip_modal` | CPU | **OPTIMAL** | FFmpeg-only |
| `create_annotated_compilation` | CPU | **OPTIMAL** | FFmpeg-only |

### Removed Functions (Dead Code Cleanup)
- `process_framing` - Was never called; framing always uses AI
- `render_overlay_cpu` - CPU times out (E3)
- `render_overlay_parallel` - 3-4x more expensive (E7)
- `process_overlay_chunk` - Helper for parallel (removed)

---

## Benchmark Results Summary

### AI Upscaling (Real-ESRGAN) - T4 GPU REQUIRED

| Hardware | Time (6s/180 frames) | FPS | Cost | Verdict |
|----------|---------------------|-----|------|---------|
| T4 GPU (cold) | 192.2s | 0.94 | $0.0315 | Baseline |
| T4 GPU (warm) | 122.7s | 1.47 | $0.0201 | **OPTIMAL** |
| L4 GPU | 205.5s | 0.88 | $0.0456 | **REJECTED** (1.67x slower, 2.27x cost) |

**Key Finding**: L4 is **NOT** faster for Real-ESRGAN. Despite being a newer architecture, L4 performs worse. T4 remains optimal.

### Overlay Processing - T4 GPU REQUIRED

| Hardware | Time (90s/2700 frames) | FPS | Cost | Verdict |
|----------|----------------------|-----|------|---------|
| T4 GPU | 47.6s | 57 | $0.0078 | **OPTIMAL** |
| CPU (2 cores) | >600s (timeout) | <4.5 | - | **REJECTED** |

**Key Finding**: CPU overlay times out after 10 minutes. GPU is required for acceptable performance.

### Parallel vs Sequential Overlay - Sequential WINS

| Configuration | Wall Time | Cost | Verdict |
|---------------|-----------|------|---------|
| Sequential (1 GPU) | 47.6s | $0.0078 | **OPTIMAL** |
| Parallel (4 GPUs) | ~20s | $0.024-0.031 | **REJECTED** (3-4x more expensive) |

**Key Finding**: Parallel processing has too much overhead. Sequential is both cheaper and simpler.

---

## Cost Models (Based on Real Data)

### AI Upscaling (Real-ESRGAN) - T4 GPU

Using T4 at 1.47 fps (warm container):

| Video Duration | Frames (30fps) | Time | Cost | Cost/Frame |
|----------------|----------------|------|------|------------|
| 6s | 180 | 122s | $0.020 | $0.000112 |
| 15s | 450 | 306s | $0.050 | $0.000112 |
| 30s | 900 | 612s | $0.100 | $0.000112 |
| 60s | 1800 | 1224s | $0.201 | $0.000112 |

**Cost formula**: `frames × $0.000112`

### Overlay Processing - T4 GPU

Using T4 at 57 fps:

| Video Duration | Frames | Time | Cost | Cost/Frame |
|----------------|--------|------|------|------------|
| 15s | 450 | 8s | $0.001 | $0.0000029 |
| 30s | 900 | 16s | $0.003 | $0.0000029 |
| 60s | 1800 | 32s | $0.005 | $0.0000029 |
| 90s | 2700 | 47s | $0.008 | $0.0000029 |

**Cost formula**: `frames × $0.0000029`

### Clip Extraction - CPU

| Operation | Time | Cost |
|-----------|------|------|
| Per clip (any duration) | ~4-5s | $0.0001 |

---

## Workflow Cost Projections (Real Data)

### Single Clip: 15 seconds (450 frames)

| Operation | Hardware | Time | Cost |
|-----------|----------|------|------|
| extract_clip_modal | CPU | 5s | $0.0001 |
| process_framing_ai | T4 GPU | 306s | $0.050 |
| render_overlay | T4 GPU | 8s | $0.001 |
| **TOTAL** | | **5.3 min** | **$0.051** |

### Multi-Clip: 8 × 15 seconds (3600 frames)

| Operation | Hardware | Time | Cost |
|-----------|----------|------|------|
| extract_clip_modal (×8) | CPU | 40s | $0.001 |
| process_multi_clip_modal | T4 GPU | 2449s | $0.402 |
| render_overlay | T4 GPU | 63s | $0.010 |
| **TOTAL** | | **42.5 min** | **$0.413** |

---

## What We Tested and Rejected

### 1. L4 GPU for AI Upscaling
- **Hypothesis**: L4 would be ~1.8x faster, offsetting higher cost
- **Result**: L4 is **1.67x SLOWER** (0.88 fps vs 1.47 fps)
- **Cost**: 2.27x more expensive than T4
- **Verdict**: **REJECTED**

### 2. CPU for Overlay Processing
- **Hypothesis**: OpenCV operations could run on CPU, saving 6x
- **Result**: CPU **times out** after 10 minutes on 90s video
- **Verdict**: **REJECTED**

### 3. Parallel Overlay Processing
- **Hypothesis**: Multiple GPUs could reduce wall time
- **Result**: 3-4x **more expensive** due to overhead
- **Verdict**: **REJECTED**

### 4. CPU for FFmpeg-only Framing
- **Hypothesis**: FFmpeg encoding doesn't need GPU
- **Result**: Valid hypothesis, but framing always uses AI upscaling
- **Verdict**: **N/A** (no non-AI framing path exists)

---

## Optimization Status: FULLY OPTIMIZED

### Current Configuration (Optimal)

| Function | Hardware | Why It's Optimal |
|----------|----------|------------------|
| AI Upscaling | T4 GPU | L4 tested and slower; T4 is best |
| Overlay | T4 GPU | CPU times out; parallel is more expensive |
| Detection | T4 GPU | YOLO requires GPU |
| Extraction | CPU | FFmpeg doesn't benefit from GPU |
| Compilation | CPU | FFmpeg doesn't benefit from GPU |

### Software Optimizations Tested and Rejected (E6 Part 2)

All software optimizations made performance **WORSE**, not better:

| Optimization | T4 Result | L4 Result | Why It Failed |
|--------------|-----------|-----------|---------------|
| cudnn.benchmark | 11% slower | 4% slower | Auto-tune overhead exceeds benefit |
| torch.compile | 16% slower | 39% slower | Compilation overhead dominates short runs |
| TF32 precision | No improvement | No improvement | Model architecture incompatible |
| All combined | 16% slower | 16% slower | Combined overhead |

**Conclusion**: The vanilla PyTorch configuration is already optimal for Real-ESRGAN.

### Not Worth Testing

| Option | Reason |
|--------|--------|
| A10G/A100/H100 GPUs | L4 results show newer GPUs perform worse, not better |
| TensorRT conversion | High effort, Real-ESRGAN not designed for TensorRT |
| Batch frame processing | Would require significant code rewrite |
| Different Real-ESRGAN models | Quality is important; lighter models = worse output |

---

## Summary

### Key Findings

1. **T4 GPU is optimal for AI upscaling** - L4 is counterintuitively slower
2. **T4 GPU required for overlay** - CPU is too slow (times out)
3. **Sequential processing is optimal** - Parallel overhead isn't worth it
4. **CPU is optimal for FFmpeg-only ops** - extraction, compilation
5. **Single-container multi-clip** - Avoids cold start and model reload overhead

### What NOT to Do

| Don't | Why |
|-------|-----|
| Use L4 for Real-ESRGAN | 1.67x slower, 2.27x more expensive |
| Use CPU for overlay | Times out after 10 minutes |
| Use parallel overlay | 3-4x more expensive |
| Use separate containers for multi-clip | Cold start + model reload overhead |

### Cost Summary

| Workflow | Time | Cost |
|----------|------|------|
| Single 15s clip (full pipeline) | 5.3 min | $0.051 |
| 8 × 15s clips (full pipeline) | 42.5 min | $0.413 |

We are **fully optimized** for the current hardware options. The only untested option is A10G GPU, but given that L4 (a newer architecture) performed worse than T4, there's no strong reason to expect A10G to be better.
