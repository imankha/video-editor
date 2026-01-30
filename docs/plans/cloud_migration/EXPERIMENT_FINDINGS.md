# Modal Experiment Findings

This document records actual measurements from Modal cost optimization experiments.

**Last Updated**: 2026-01-29

---

## CRITICAL FINDING: Code Path Analysis

### Framing Always Uses AI Upscaling

**Discovery Date**: 2026-01-29

After analyzing the actual code paths:

1. **`/export/render`** endpoint (framing.py:931) calls `call_modal_framing_ai` - **always AI**
2. **`/export/upscale`** endpoint also uses AI upscaling - **always AI**
3. The `process_framing` (non-AI FFmpeg only) function was **never called** in any production code path

**Impact on cost projections**: Previous projections that split framing into "AI" and "non-AI" categories were incorrect. All framing exports use Real-ESRGAN AI upscaling on GPU.

### Code Cleanup Performed

Removed dead code that was never used:
- `process_framing` from video_processing.py (Modal function)
- `call_modal_framing` from modal_client.py
- `process_framing_with_modal` from export_worker.py
- `_get_process_framing_fn` helper

---

## Test Configuration

### Test Video
- **Source**: `formal annotations/test.short/wcfc-carlsbad-trimmed.mp4`
- **Duration**: 90 seconds
- **Resolution**: 1920x1080
- **FPS**: 30
- **R2 Location**: `modal_test/test_videos/wcfc-carlsbad-trimmed.mp4`

### Test Clips
| Clip | Start | End | Duration | Frames (30fps) |
|------|-------|-----|----------|----------------|
| Short clip | 3.0s | 9.0s | 6s | 180 |
| Medium clip | 3.0s | 33.0s | 30s | 900 |
| Full video | 0s | 90s | 90s | 2700 |

---

## E1: Baseline Measurements

**Status**: `COMPLETE`
**Date**: 2026-01-29

### Results

| Function | Hardware | Time | Cost | Notes |
|----------|----------|------|------|-------|
| `render_overlay` | T4 GPU | 7-46s | $0.0011-$0.0075 | Wide variance (cold/warm) |
| `process_framing_ai` | T4 GPU | 185s | $0.0303 | Real-ESRGAN upscaling |
| `create_annotated_compilation` | CPU | 15.4s | $0.0004 | FFmpeg concat only |
| `extract_clip_modal` | CPU | 4s | $0.0001 | Warm container |

**Note**: `process_framing` (non-AI) was measured but is never actually called in production.

---

## E2: FFmpeg Frame Reading Investigation

**Status**: `COMPLETE`
**Date**: 2026-01-29

### Objective
Investigate if OpenCV drops frames when reading video files (potential bug requiring FFmpeg pipe fix).

### Test Method
Created `tests/test_frame_reading.py` that:
1. Creates synthetic test videos with known frame count
2. Compares OpenCV frame count vs ffprobe authoritative count
3. Also tests FFmpeg pipe reading method

### Results

| Test | Result | Notes |
|------|--------|-------|
| OpenCV CFR reading | **PASS** | Read all frames correctly |
| OpenCV seeking accuracy | **PASS** | Seeking works correctly |
| FFmpeg pipe reading | **PASS** | Read all frames correctly |
| All methods comparison | **PASS** | OpenCV = ffprobe = FFmpeg |

### Key Finding

**No frame drop bug detected** with synthetic constant frame rate (CFR) videos.

The frame drop issue, if it exists, may be specific to:
- Variable frame rate (VFR) videos
- Certain codecs/containers
- Corrupted video files

### Decision

- **No fix needed at this time** - OpenCV works correctly for standard videos
- **Test framework in place** - Can detect issues if they occur with specific videos
- **Monitor for issues** - If frame drops are reported, run test with the problematic video

### Test Location

```bash
cd src/backend
pytest tests/test_frame_reading.py -v
```

---

## E3: CPU vs GPU Comparison

**Status**: `COMPLETE`
**Date**: 2026-01-29

### Objective
Determine if overlay and framing are cheaper on CPU or GPU.

### Results

| Function | Hardware | Time | FPS | Cost | Status |
|----------|----------|------|-----|------|--------|
| Overlay | T4 GPU | 278s | 9.7 | $0.0456 | Success |
| Overlay | CPU | >600s | ~4.4 | - | **TIMED OUT** |
| Framing (FFmpeg only) | T4 GPU | 16.6s | 10.9 | $0.0027 | Success |
| Framing (FFmpeg only) | CPU | 10.9s | 16.5 | $0.0003 | **Success - 89% cheaper** |

### Key Findings

1. **CPU Overlay is NOT viable**: Timed out after 10 minutes on a 90s video
   - OpenCV frame-by-frame processing is too slow on CPU
   - GPU is required for acceptable performance

2. **CPU Framing is faster AND cheaper** (for FFmpeg-only, but see note below):
   - CPU: 10.9s, $0.0003
   - GPU: 16.6s, $0.0027
   - **However**: This function is never called - framing always uses AI

3. **Real-world impact**: Since framing always uses AI upscaling (`process_framing_ai`), the CPU framing optimization is irrelevant.

### Decision
- **Overlay**: Keep on GPU (CPU not viable)
- **Framing**: Always uses AI, must stay on GPU

---

## Modal Pricing Reference

| Resource | Per Second | Per Hour |
|----------|------------|----------|
| T4 GPU | $0.000164 | $0.59 |
| L4 GPU | $0.000222 | $0.80 |
| CPU (2 cores) | $0.0000262 | $0.094 |

---

## B1: Multi-Clip Modal Integration

**Status**: `TESTING` (isolation test passed, integration test in progress)
**Date**: 2026-01-29

### Objective
Add `process_multi_clip_modal` function that processes multiple clips with AI upscaling in a single container.

### Architecture
```
process_multi_clip_modal (single container)
├── Download all source clips from R2
├── Load Real-ESRGAN ONCE
├── For each clip: crop → upscale → resize → encode
├── Concatenate with transitions
└── Upload final to R2
```

### Benefits vs Composition Approach
- Single cold start (7s vs N×7s)
- Single model load (4s vs N×4s)
- No intermediate R2 transfers

### Isolation Test Results

| Metric | Value |
|--------|-------|
| Test clips | 2 clips × 3s each |
| Total time | 137.5s |
| Status | **SUCCESS** |
| Clips processed | 2 |
| Processing rate | 1.31 fps |
| Time per clip | 68.7s |

### Integration Test (In Progress)

| Metric | Value |
|--------|-------|
| Test clips | 8 clips (real user project) |
| Progress at last check | ~22% |
| Expected time | 10-30 minutes |
| Status | **RUNNING** |

### Bugs Fixed During Testing

| Bug | Root Cause | Fix |
|-----|------------|-----|
| `await upload_bytes_to_r2()` error | Sync function being awaited | Removed erroneous `await` |
| Manual projects showed 0 clips extracted | `COALESCE(auto_project_id, wc.project_id)` always picked auto_project_id | Changed to UNION query |

### Test Command

```bash
cd src/backend
python experiments/test_multi_clip_modal.py
```

### Results Location
- `experiments/test_multi_clip_results.json`

---

## Current Modal Functions (After Cleanup)

### Active Functions

| Function | Hardware | Used? | Notes |
|----------|----------|-------|-------|
| `render_overlay` | T4 GPU | **YES** | Overlay export |
| `process_framing_ai` | T4 GPU | **YES** | All framing (AI upscaling) |
| `process_multi_clip_modal` | T4 GPU | **YES** | Multi-clip AI upscaling (NEW) |
| `extract_clip_modal` | CPU | **YES** | Clip extraction |
| `create_annotated_compilation` | CPU | **YES** | Compilations |
| `detect_players_modal` | T4 GPU | **YES** | YOLO detection |

### Removed Functions (Dead Code Cleanup 2026-01-29)

| Function | Reason for Removal |
|----------|-------------------|
| `process_framing` | Never called - framing always uses AI |
| `render_overlay_cpu` | CPU overlay not viable (times out) |
| `process_framing_cpu` | Experimental, never integrated |
| `render_overlay_parallel` | E7 proved costs 3-4x MORE |
| `process_overlay_chunk` | Helper for parallel (removed) |
| `process_framing_ai_l4` | E6 experiment only (not needed) |

---

## Summary of Findings

### Confirmed Results

| Finding | Impact |
|---------|--------|
| CPU overlay not viable | Must keep on GPU |
| Framing always uses AI | No "cheap FFmpeg-only" path exists |
| Parallel overlay costs more | Sequential is optimal |
| CPU extract/compile optimal | Already running on CPU |

### Corrected Cost Projection (1000 exports/month)

**Actual Configuration:**
| Export Type | Count | Per-Export | Monthly |
|-------------|-------|------------|---------|
| Overlay (GPU) | 400 | $0.0075 | $3.00 |
| Framing AI (GPU) | 500 | $0.0303 | $15.15 |
| Compilation (CPU) | 100 | $0.0004 | $0.04 |
| **Total** | | | **$18.19** |

Note: Previous projections incorrectly assumed some framing could be done without AI ($0.0077 instead of $0.0303). The actual cost is higher because all framing uses Real-ESRGAN.

---

## Remaining Optimization Opportunities

| Optimization | Expected Savings | Priority |
|--------------|------------------|----------|
| L4 vs T4 for AI upscaling | 30-50% if L4 is faster | Medium |
| Container keep-warm for overlay | Up to 85% reduction | Medium |
| NVENC vs libx264 encoding | Unknown | Low |

### What We Cannot Optimize

| Item | Reason |
|------|--------|
| Move overlay to CPU | Times out - not viable |
| Move framing to CPU | Always needs GPU for Real-ESRGAN |
| Parallel overlay | Costs 3-4x more than sequential |

---

## Running Experiments

### Commands

```bash
cd src/backend

# Deploy Modal functions (after cleanup)
modal deploy app/modal_functions/video_processing.py

# E3: CPU vs GPU (already complete - see results above)
python experiments/e3_cpu_vs_gpu.py
```

### Results Location

- `experiments/e1_results.json` - Baseline measurements
- `experiments/e3_cpu_vs_gpu_results.json` - CPU vs GPU comparison
- `experiments/e_parallel_results.json` - Parallelization analysis
