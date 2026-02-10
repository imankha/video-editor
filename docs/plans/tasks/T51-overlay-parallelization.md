# T51: Overlay Parallelization Analysis

**Status:** TODO
**Impact:** MEDIUM
**Complexity:** MEDIUM
**Created:** 2026-02-09
**Updated:** 2026-02-09

## Problem

The overlay endpoint (`render_overlay`) processes video frame-by-frame on a single GPU. For longer videos, this can be slow. We should analyze whether parallelization (like we did for framing in T50) would provide speedup.

**Note:** E7 experiment previously found overlay parallelization costs 3-4x MORE due to frame dependencies. This task is to re-evaluate with the new chunk-based approach.

## Solution

Apply the same analysis methodology from T50:
1. Collect baseline timing data for overlay processing
2. Test parallel processing with 2 and 4 GPU chunks
3. Compare wall-clock time and cost
4. Implement if beneficial, skip if not

## Context

### Relevant Files
- `src/backend/app/modal_functions/video_processing.py` - `render_overlay()` function
- `src/backend/app/services/modal_client.py` - `call_modal_overlay()`
- `src/backend/experiments/e_parallel_analysis.py` - Previous E7 experiment

### Related Tasks
- Depends on: T50 (Modal Cost Optimization) - DONE
- Related: T52 (Annotate Parallelization)

### Technical Notes

**Key Difference from Framing:**
- Overlay processing requires highlight region interpolation between frames
- Frames may have temporal dependencies (highlight keyframes span time ranges)
- Per-frame processing is faster (~25ms vs ~680ms for Real-ESRGAN)

**E7 Finding (previous):**
- Parallel overlay was 3-4x MORE expensive
- Frame dependencies caused issues
- Sequential was optimal

**Re-evaluation Questions:**
1. Can we chunk by time ranges that don't cross highlight boundaries?
2. Is the overhead still too high given faster per-frame processing?
3. Would a different chunking strategy work?

## Implementation

### Phase 1: Baseline Data
1. [ ] Measure overlay per-frame processing time
2. [ ] Test on 30s, 60s, 120s videos
3. [ ] Document current sequential performance

### Phase 2: Experiment (if promising)
1. [ ] Create `render_overlay_chunk` function
2. [ ] Create `render_overlay_parallel` orchestrator
3. [ ] Benchmark 2 and 4 GPU configurations
4. [ ] Compare cost vs time tradeoffs

### Phase 3: Decision
1. [ ] Document findings
2. [ ] Implement if beneficial (>2x speedup at similar cost)
3. [ ] Skip if not beneficial (document why)

## Acceptance Criteria

- [ ] Baseline performance documented
- [ ] Parallelization tested (or decision documented to skip)
- [ ] If implemented: thresholds tuned based on data
- [ ] Results documented in task file
