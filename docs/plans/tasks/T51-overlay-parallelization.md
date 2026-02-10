# T51: Overlay Parallelization Analysis

**Status**: CLOSED - NOT BENEFICIAL
**Priority**: P2 - Performance Optimization
**Complexity**: STANDARD
**Resolution**: Analysis complete - parallelization is cost-prohibitive

## Problem Statement

The overlay rendering pipeline processes frames sequentially. Given the success of T50 (framing parallelization achieved 3.56x speedup with 4 GPUs at same cost), we needed to analyze whether similar chunk-based parallelization would benefit overlay rendering.

## Conclusion: NOT BENEFICIAL

**E7 experiment (2026-01-29) already tested this definitively:**

| Configuration | Wall Time | Cost | vs Sequential |
|--------------|-----------|------|---------------|
| Sequential (1 GPU) | 45.56s | $0.00747 | Baseline |
| Parallel 2-GPU | 45.42s | $0.01216 | **+62.7% more expensive** |
| Parallel 4-GPU | 49.10s | $0.02603 | **+248.3% more expensive** |

**Key Finding**: Parallel 2-GPU was only 0.3% faster but cost 63% more. Parallel 4-GPU was actually *slower* and cost 2.5x more.

## Why Parallelization Fails for Overlay

### The Math

| Metric | Framing (T50) | Overlay (T51) |
|--------|---------------|---------------|
| Per-frame cost | ~680ms | ~25ms |
| Parallelization overhead | ~15-20s | ~15-20s |
| Processing time (300 frames) | 204s | 7.5s |
| Overhead as % of processing | 7-10% | 200-266% |

For framing, the 680ms/frame cost meant parallelization overhead was negligible. For overlay, the 25ms/frame cost means overhead **dominates** any gains.

### Overhead Sources (per additional GPU)
- Modal cold start: 10-30s
- Video download + seek: 2-5s
- FFmpeg process startup: 1-3s
- Chunk concatenation: 5-10s
- **Total: ~20-50s per GPU added**

## Relevant Files

- **Modal Function**: `src/backend/app/modal_functions/video_processing.py:149-391`
- **Client Interface**: `src/backend/app/services/modal_client.py:810-992`
- **E7 Results**: `src/backend/experiments/e_parallel_results.json`

## Acceptance Criteria

- [x] Baseline timing data collected for render_overlay (from E7)
- [x] Analysis of where time is spent (overhead dominates)
- [x] Recommendation: **"Not beneficial"** - parallelization costs 62-248% more
- [x] Document findings and close task

## Progress Log

**2026-02-09**: Task started. Created feature branch `feature/T51-overlay-parallelization`.

**2026-02-09**: Code Expert audit completed. Found E7 experiment from 2026-01-29 already tested overlay parallelization:
- Parallel 2-GPU: 0.3% faster, 62.7% more expensive
- Parallel 4-GPU: 8% slower, 248.3% more expensive
- Root cause: 25ms/frame overlay cost is too low; parallelization overhead dominates

**2026-02-09**: Task closed as NOT BENEFICIAL. No further benchmarking needed.
