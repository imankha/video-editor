# T3950: "Made with Reel Ballers" Outro on Exports

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-06-25
**Updated:** 2026-06-25

## Problem

Every reel a parent exports and shares to Instagram/TikTok/WhatsApp is free organic
reach for us — but right now there's nothing on the video that says where it came from.
CapCut's single biggest growth lever is the "Made with CapCut" end card: every shared
clip is an ad. We have the same distribution (T442 Web Share API ships reels straight to
social) with none of the attribution.

## Solution

Append a short branded outro (~1.5–2s) — "Made with Reel Ballers" + logo (+ URL) — to the
end of exported videos, rendered at export time. Must cover both export paths and all
aspect ratios so it looks right wherever the reel is shared:

- **Single-clip / reel export** (the main framing→overlay→export flow)
- **Collection / compilation export** (stitched multi-clip videos)
- **Aspect ratios:** 9:16, 1:1, 16:9 (the outro asset must match the reel's ratio)

The outro is added by the render pipeline (FFmpeg concat), NOT stored in the working
clip/keyframe data — it's a presentation step at export, like a watermark.

## Context

### Relevant Files (REQUIRED)
*(Code Expert to confirm exact functions; these are the entry points.)*
- `src/backend/app/modal_functions/video_processing.py` — Modal/FFmpeg render pipeline (single-clip render + collection/compilation concat). Primary change: append the outro segment before final encode.
- Clip-export finalize path (export worker / `_sync_after_export` area) — where the rendered MP4 is produced and uploaded to R2.
- Collection/compilation export path (the stitched-MP4 render for collections).
- Frontend export trigger (e.g. `useExport` / export button) — only if we add a toggle.
- **New asset(s):** branded end-card source (logo + wordmark), or a programmatic FFmpeg-drawtext/overlay card, rendered/cropped per aspect ratio.

### Related Tasks
- Related: T442 (Web Share API — shared reels go straight to social, so attribution compounds)
- Related: T2680 (we model CapCut's user-upload liability profile; the end card mirrors their growth model too)
- Touches the same render pipeline as the auto-export recap (T1583) — apply consistently if recaps are shared.

### Technical Notes
- **Render-time only, no reactive persistence** (CLAUDE.md): the outro is added during export; do not write it into segments/keyframes or trigger any state write-back.
- **Aspect ratios:** generate or select the matching end-card per ratio; don't letterbox a 16:9 card onto a 9:16 reel.
- **Audio:** the reel's audio should end cleanly; the outro can be silent or a short sting — fade to avoid a hard cut.
- **Duration budget:** for collections that are duration-capped, decide whether the outro counts toward or sits outside the budget (recommend: outside — it's chrome, not content).
- **No double-outro:** ensure re-export / collection-of-already-exported-clips doesn't stack multiple end cards (the outro is added once, at the outermost render).
- **Future hook (out of scope here, note only):** a paid "remove branding" toggle later — keep the outro behind a single flag so it's easy to gate.

## Implementation

### Steps
1. [ ] Decide end-card design + produce the asset(s) per aspect ratio (or a programmatic FFmpeg card).
2. [ ] Add the outro concat to the single-clip / reel render in `video_processing.py`.
3. [ ] Add the outro to the collection / compilation export path (once, at the stitch step).
4. [ ] Handle all three aspect ratios + a clean audio transition.
5. [ ] Guard against double-outro on re-export and collection stitching.

## Acceptance Criteria

- [ ] Exported single-clip reels end with the "Made with Reel Ballers" outro, correct for the reel's aspect ratio.
- [ ] Exported collections/compilations end with exactly one outro.
- [ ] All three aspect ratios (9:16, 1:1, 16:9) render the card correctly (no letterboxing/stretch).
- [ ] No outro data leaks into working clip/keyframe state; it's purely render-time.
- [ ] Existing export tests pass; a test asserts the outro is appended for each path/ratio.
