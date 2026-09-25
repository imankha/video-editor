# T11340: Parallelize Multi-Clip Export Across GPUs

**Status:** TODO
**Impact:** 7
**Complexity:** 8
**Created:** 2026-09-25
**Updated:** 2026-09-25

## Problem

`process_clips_ai` (`video_processing.py:2789`, the multi-clip export path used for every Focus
export including single-clip via a one-element list — see `modal-gpu.md` Entry points) always runs
on exactly 1 T4 GPU, sequentially, with a fixed `timeout=3600`, regardless of how many clips or how
much total footage is requested. There is no scaling with workload. This is a real ceiling, not
just a guard-rail problem: T11320's preflight guard (this epic) will correctly REJECT legitimate
large exports (e.g. a user compiling many clips at a real crop, not just Bug 58p's degenerate
full-frame case) that a parallel path could actually finish.

The single-clip framing path already solved this shape of problem —
`process_framing_ai_parallel` (`:2043`, CPU orchestrator) fans work out across
`process_framing_ai_chunk` (`:1840`, T4 each) workers based on `get_framing_ai_gpu_config(duration)`
(1/2/4 GPUs by clip duration). `process_clips_ai` has no equivalent.

## Solution

Port the chunking/fan-out pattern from `process_framing_ai_parallel` to the multi-clip path: split
the clip list (or long individual clips) across N T4 workers, process in parallel, concat as today.
Read the existing parallel implementation first — this is adapting a proven pattern, not designing
one from scratch. Key differences to work through:
- `process_framing_ai_parallel` chunks ONE clip by time; multi-clip export has natural chunk
  boundaries already (clip boundaries) — chunking by clip is likely simpler than by time, but a
  single very long clip within the list may still need time-chunking too
- Concat order must stay deterministic when clips finish out of order
- Cost impact: more GPUs = faster wall clock but the same or higher total GPU-seconds billed
  (confirm this tradeoff is intentional/acceptable — E7's experiment found parallel overlay
  rendering 3-4x costlier, per `modal-gpu.md`; multi-clip framing parallelization needs its own
  cost check before shipping, not an assumption that it's free)

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/modal_functions/video_processing.py` — `process_framing_ai_parallel` (`:2043`),
  `process_framing_ai_chunk` (`:1840`), `process_clips_ai` (`:2789`) — the three functions this
  task reconciles
- `src/backend/app/services/modal_client.py` — `call_modal_clips_ai` (`:925`), GPU-config selection
  (`get_framing_ai_gpu_config`, `:412`) as a reference pattern for a multi-clip equivalent
- `.claude/knowledge/modal-gpu.md` — update GPU-selection and function-table sections after this
  ships (this doc is the single source of truth other tasks read instead of re-auditing)

### Related Tasks
- Related: T11320 (this task raises the ceiling T11320 estimates against — sequence so T11320
  ships first with a conservative single-GPU-based estimate, then this task's landing is a pure
  capacity increase, not a guard rewrite)
- Requires a Modal redeploy (staging first, verify, then prod per backend CLAUDE.md) — ask the
  user before deploying, same as any `app/modal_functions/` change

### Technical Notes
- This is an L-tier, design-gated task (new pattern in a production GPU pipeline, real cost
  tradeoffs) — run the full Architect design gate before implementation, do not skip to Stage 4.
- `video_processing_optimized.py` has 8 T4/L4 benchmark variants already explored for a related
  problem (never wired to production, T4420 will delete it) — check whether any of that
  experimentation is relevant before designing from scratch.

## Implementation

### Steps
1. [ ] Architect design doc: chunking strategy (by-clip vs by-time), concat-ordering guarantee, cost model
2. [ ] User approval of design (real cost/latency tradeoff — this is a design gate, not a rubber stamp)
3. [ ] Implement parallel `process_clips_ai` variant behind the existing `modal_client` unified interface (no router-level Modal calls)
4. [ ] Staging deploy + verify (real multi-clip, non-30fps upload, Bug 58p's actual clip shape as a repro case)
5. [ ] Prod deploy after staging verification
6. [ ] Update `modal-gpu.md`

### Progress Log

**2026-09-25**: Filed from Bug 58p investigation. Not started. User flagged this epic as top
priority (2026-09-25).

## Acceptance Criteria

- [ ] A project shaped like Bug 58p's 14-clip full-frame export completes within Modal's timeout
      budget (or is still correctly rejected by T11320 if genuinely infeasible even parallelized —
      confirm which outcome is expected before calling this done)
- [ ] Concat output is byte-identical in clip order to the sequential path for a fixture with
      overlapping completion times
- [ ] Cost-per-export impact is measured and reported, not assumed
