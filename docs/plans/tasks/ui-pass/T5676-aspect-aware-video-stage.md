# T5676: Aspect-aware video stage (kill the 9:16 pillarbox)

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-20
**Epic:** [UI Pass](EPIC.md) — task 6 of 7

## Problem

Audit finding #7: on the **Overlay** screen a 9:16 (808×1440) reel renders inside a stage
sized 16:9-ish to the content column, so roughly **two-thirds of the preview area is black
pillarbox** and the actual video is a small strip in the middle (desktop 1315×748 screenshot
evidence). The player controls bar and the "Tap the spotlight…" hint span the full 16:9 stage
width, visually detached from the video they control. Nearly every reel in this product is
9:16 — the editor's main preview is optimized for the aspect ratio users almost never have at
this stage.

Framing is different by design (it shows the full 16:9 source with a 9:16 crop reticle —
correct as-is). Annotate shows source footage (16:9) — also fine. The defect is stages that
show *output-aspect* video (Overlay; also the draft preview player if it shares the
container).

## Solution

Size the video stage to the **video's aspect ratio** within the available box (standard
`fit = min(availW/videoW, availH/videoH)` letterbox-free sizing):

- Stage wrapper shrink-wraps the video: height-constrained on desktop (video fills available
  height, width follows aspect), width-constrained on narrow screens.
- Player controls + hint bar attach to the video width, not the column width.
- Freed horizontal space on desktop: the Overlay Settings panel can sit beside the video
  instead of below the fold (audit: at 748px height the timeline required scrolling —
  reclaiming pillarbox width may let video + settings + timeline fit the viewport). Exact
  arrangement per UI Designer.
- Must remain correct for 16:9 output reels (the container adapts, not hardcoded portrait).

## Context

### Relevant Files (REQUIRED)
- Overlay screen video container — `src/frontend/src/modes/overlay/` (screen + video stage wrapper; the `.video-container` element referenced by `useVideoDisplayRect`)
- `useVideoDisplayRect` — READ ONLY dependency: T4550/T5590 coordinate math maps overlays via this hook and it already observes container resizes (T5590 added a ResizeObserver). Changing the container's size is safe *because* of that observer — do not modify the hook.
- Shared `Controls` / player bar layout (width coupling)
- Draft preview player (`MediaPlayer` usage in `ProjectManager.jsx:2256`) — check whether it letterboxes 9:16 the same way; include if same container pattern, else note and exclude

### Related Tasks
- Builds on: T5590 (ResizeObserver in `useVideoDisplayRect`) — the enabling invariant
- Do not conflict with: T5610 (spotlight discoverability hint placement — coordinate if both queued)

### Technical Notes
- **High-risk adjacency:** spotlight circles, detection boxes, and crop reticles are
  positioned via `useVideoDisplayRect` transforms. Container resizing is exactly the class of
  change that has caused drift bugs (T5590). Real-browser verification of overlay alignment
  after resize is mandatory — jsdom cannot prove alignment (T5380 lesson; standing rule:
  real browser for pointer/overlay fixes).
- Fullscreen paths (desktop `isFullscreen`, `mobileFs`) must be re-verified.
- Presentational/layout only; no persistence, no export-path changes (render pipeline
  unaffected — this is the *preview* stage).

## Implementation

### Steps
1. [ ] Audit stage sizing in Overlay + draft preview player; confirm shared vs separate containers
2. [ ] UI Designer: desktop arrangement with reclaimed width (settings beside video?) — approval
3. [ ] Aspect-fit stage wrapper; controls/hint bind to video width
4. [ ] Real-browser verify: spotlight/detection alignment at 390, 768, 1315, fullscreen both kinds, 9:16 AND 16:9 reels
5. [ ] E2E: overlay alignment spec extension if the T5590 spec has a seam for it

## Acceptance Criteria

- [ ] 9:16 reel in Overlay: video fills available height, no giant side pillarboxes; controls span the video, not the column
- [ ] 16:9 reel still renders correctly (no regression to landscape output)
- [ ] Spotlight circle + detection boxes stay aligned after the change (real-browser evidence, both aspects, incl. fullscreen + mobileFs)
- [ ] Desktop 1315×748: less scrolling than before to reach the timeline (screenshot comparison)
- [ ] Frontend tests pass; screenshots at 390 and 1315
