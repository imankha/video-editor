# T52: Annotate Parallelization Analysis

**Status:** WON'T DO
**Impact:** MEDIUM
**Complexity:** MEDIUM
**Created:** 2026-02-09
**Updated:** 2026-02-10

## Decision

**WON'T DO** - Annotate is CPU-bound (FFmpeg text rendering), not GPU-bound. Parallelization won't help since the bottleneck is CPU, not GPU containers.

See completed analysis in PLAN.md "Performance Analysis (2026-02)" section.

## Problem

The annotate endpoint (`create_annotated_compilation`) processes video clips sequentially on a single GPU. For multi-clip compilations, this can be slow. We should analyze whether parallelization would provide speedup.

## Solution

Apply the same analysis methodology from T50:
1. Collect baseline timing data for annotate processing
2. Test parallel processing with 2 and 4 GPU chunks
3. Compare wall-clock time and cost
4. Implement if beneficial, skip if not

## Context

### Relevant Files
- `src/backend/app/modal_functions/video_processing.py` - `create_annotated_compilation()` function
- `src/backend/app/services/modal_client.py` - Modal client integration
- `src/backend/experiments/e7_parallel_benchmark.py` - Benchmark template from T50

### Related Tasks
- Depends on: T50 (Modal Cost Optimization) - DONE
- Related: T51 (Overlay Parallelization)

### Technical Notes

**Annotate Processing:**
- Renders text overlays (player names, ratings, timestamps)
- Uses FFmpeg drawtext filter
- CPU-bound (no AI/GPU acceleration needed for text)
- Processes clips sequentially, concatenates at end

**Parallelization Candidates:**
1. **Per-clip parallelization**: Each clip rendered on separate container
2. **Chunk-based**: Split long clips into time chunks (like framing)

**Considerations:**
- Text rendering is CPU-bound, not GPU-bound
- May benefit more from CPU parallelization than GPU
- Clip boundaries are natural split points

## Implementation

### Phase 1: Baseline Data
1. [ ] Measure annotate per-clip processing time
2. [ ] Test with 3-clip, 5-clip, 10-clip compilations
3. [ ] Document current sequential performance
4. [ ] Identify bottleneck (CPU vs GPU vs I/O)

### Phase 2: Experiment (if promising)
1. [ ] Create parallel clip processing function
2. [ ] Benchmark 2 and 4 container configurations
3. [ ] Compare cost vs time tradeoffs

### Phase 3: Decision
1. [ ] Document findings
2. [ ] Implement if beneficial (>2x speedup at similar cost)
3. [ ] Skip if not beneficial (document why)

## Acceptance Criteria

- [ ] Baseline performance documented
- [ ] Parallelization tested (or decision documented to skip)
- [ ] If implemented: thresholds tuned based on data
- [ ] Results documented in task file
