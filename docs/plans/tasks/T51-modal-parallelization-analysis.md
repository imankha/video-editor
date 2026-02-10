# T51: Modal Parallelization Analysis

**Status**: DONE
**Priority**: P2 - Performance Optimization
**Complexity**: STANDARD
**Resolution**: Full audit complete - all endpoints already optimized

## Problem Statement

Following T50's success (framing parallelization achieved 3.56x speedup), analyze whether other Modal endpoints could benefit from parallelization or other optimizations.

## Summary: All Endpoints Already Optimized

| Endpoint | Parallelization | Status |
|----------|-----------------|--------|
| Framing (Real-ESRGAN) | 4-GPU = 3.56x speedup | Already optimized (T50) |
| Overlay | NOT beneficial (62-248% more expensive) | No action needed |
| Detection | Batch API exists, already efficient | No action needed |
| Annotate compilation | CPU-bound, parallel won't help | No action needed |
| Model loading | Baked into images | Already optimized |

---

## 1. Overlay Parallelization: NOT BENEFICIAL

**E7 experiment (2026-01-29) already tested this definitively:**

| Configuration | Wall Time | Cost | vs Sequential |
|--------------|-----------|------|---------------|
| Sequential (1 GPU) | 45.56s | $0.00747 | Baseline |
| Parallel 2-GPU | 45.42s | $0.01216 | **+62.7% more expensive** |
| Parallel 4-GPU | 49.10s | $0.02603 | **+248.3% more expensive** |

**Root cause**: 25ms/frame cost is too low; parallelization overhead (cold starts, downloads) dominates.

---

## 2. Detection: ALREADY OPTIMIZED

Two endpoints exist:
- `detect_players_modal` - Single frame (downloads entire video per call)
- `detect_players_batch_modal` - Multiple frames (downloads once, processes many)

**Current usage**: Batch detection runs automatically during framing export. Frontend only reads from cache. No optimization needed.

---

## 3. Annotate Compilation: CPU-BOUND

`create_annotated_compilation` is CPU-only (FFmpeg encoding with drawtext filter).

**Why parallelization won't help**:
- Multi-container: Each downloads full video (same overhead problem)
- Multi-process: FFmpeg already uses all CPU cores

---

## 4. Model Loading: ALREADY OPTIMIZED

Models are **baked into Modal images** during build, not downloaded at runtime:

```python
# YOLO - pre-downloaded in image build
yolo_image = modal.Image...
    .run_commands("python -c \"from ultralytics import YOLO; YOLO('yolov8x.pt')\"")

# Real-ESRGAN - pre-downloaded in image build
upscale_image = modal.Image...
    .run_commands("wget -O /root/.cache/realesrgan/weights/realesr-general-x4v3.pth ...")
```

Cold start overhead is only container spin-up (~5-15s), not model downloads.

---

## Relevant Files

- **Modal Functions**: `src/backend/app/modal_functions/video_processing.py`
- **Modal Client**: `src/backend/app/services/modal_client.py`
- **E7 Results**: `src/backend/experiments/e_parallel_results.json`
- **Detection batch**: `video_processing.py:606-752`
- **Annotate compilation**: `video_processing.py:1841-2000`

## Acceptance Criteria

- [x] Analyze overlay parallelization (E7 data: not beneficial)
- [x] Analyze detection parallelization (batch API already exists)
- [x] Analyze annotate compilation (CPU-bound, can't parallelize)
- [x] Verify model loading is optimized (baked into images)
- [x] Document findings

## Progress Log

**2026-02-09**: Task started. Created feature branch.

**2026-02-09**: Code Expert audit found E7 experiment already tested overlay parallelization - costs 62-248% more than sequential.

**2026-02-09**: Analyzed detection endpoint - batch API (`detect_players_batch_modal`) already exists and is used during framing export. Frontend only reads cache.

**2026-02-09**: Analyzed annotate compilation - CPU-bound FFmpeg encoding, parallelization won't help.

**2026-02-09**: Verified model loading - YOLO and Real-ESRGAN weights are baked into Modal images during build, not downloaded at runtime.

**2026-02-09**: Task complete. All Modal endpoints are already optimized.
