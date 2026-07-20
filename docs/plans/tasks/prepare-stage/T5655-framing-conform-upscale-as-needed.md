# T5655: Framing conform-from-master + upscale-only-as-needed

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Created:** 2026-07-20
**Epic:** [Multi-File Ingest & Prep](EPIC.md) (task 5/7)

## Epic Context
See [EPIC.md](EPIC.md) + study section 0. The output-quality half of the dual-asset pipeline:
Framing preview stays on the proxy, but export conforms the crop from the MASTER, and AI upscale
runs ONLY when the native crop is below target.

## Problem
Framing must produce full-res output from the master (not the 720p proxy), reading only the crop
ROI x clip window, and must skip upscale when the native crop already meets the target.

## Solution
- Framing live crop-drag preview = proxy (LRF); crop stored as normalized coords (resolution-agnostic).
- Export/conform reads the crop ROI x clip time from the **master ref** (T5651), native res. Never
  streams whole 8K - only the ROI window (this is the "access the right parts of the MP4" step).
- **Upscale gate:** run AI upscale only if `crop_native_resolution < target_output_resolution`. For
  8K sources most crops are already >=1080p -> skip upscale. Keep upscale for genuinely small crops
  or low-res sources. No silent fallback - log when upscale is skipped vs run.
- (Optional stretch) stream the ROI into the Framing preview for a sharp adjust experience.

## Context
### Relevant Files
- `.claude/knowledge/keyframes-framing.md` + `modal-gpu.md` + `export-pipeline.md` (load first).
- `src/backend/app/services/export/framing.py`, `multi_clip.py`, Modal path (upscale trigger).
- Crop normalized-coords + `useCrop` / `useVideoDisplayRect` (resolution-agnostic already).

### Related Tasks
- Depends on T5651 (master ref) + T5653 (aligned assets) + T5654 (clip times). Shares lens de-warp
  with T5657 and rotation with [T5640](../T5640-framing-rotation-horizon-straighten.md).

### Technical Notes
- Crop coords MUST be normalized so the same crop resolves on proxy (preview) and master (output).
- Upscale gate is a correctness/cost win; make the decision visible (log), never a silent guess.

## Acceptance Criteria
- [ ] Framing preview on proxy; export pixels from master ROI, native.
- [ ] Upscale runs only when native crop < target; skip is logged, output is full quality.
- [ ] A tight 8K crop exports crisp with NO upscale (matches study prototype).
