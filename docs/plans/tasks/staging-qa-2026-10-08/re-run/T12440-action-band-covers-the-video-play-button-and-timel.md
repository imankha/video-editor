# T12440: Action band covers the video Play button and timeline on Focus and Overlay (desktop)

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Tier:** M
**Created:** 2026-10-11
**Updated:** 2026-10-11
**Found by:** [T12310](../T12310-re-run-staging-walkthrough.md) staging re-run, finding(s) N1 (severity HIGH). Evidence: [RESULTS.md](../../../ux/2026-10-08-staging-qa-walkthrough/re-run/RESULTS.md) section 3; screenshots in the same folder (rr-NN-*.jpg, kept local and not committed; re-capture on staging if missing).

## Problem

On Focus and Overlay the bottom action band overlays the video: at 1440x900 the band starts at y=668 while the video controls sit at y=779 beneath it, the Focus pane does not scroll (wheel zooms the timeline), so the Play button, the bottom of the video and the timeline are hidden. The guide says "Tap Play and watch your athlete" but only the Space key plays. Overlay is the same until the main pane is scrolled a full screen. Seen at 1024x768, 1440x900 and 1920x1080 (768x1024 is fine).

Screenshots: rr-14-focus-scrolled-1440, rr-18, rr-40, sweep-focus-1024x768, sweep-focus-1920x1080.

## Solution

Make the band part of the layout: reserve its height under the video and timeline, or move Play into the video area above the band. Do not change the band content or CTA order.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/focus/FramingActionRow.jsx`
- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/modes/FramingModeView.jsx`

### Related Tasks

- Source: T12310. Staging QA Walkthrough milestone (README.md in the parent folder).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12440:`

## Acceptance Criteria

- [ ] At 1024x768, 1440x900 and 1920x1080 the Focus and Overlay video controls and timeline are fully visible without scrolling the page
- [ ] No horizontal overflow at 768, 1024, 1440
- [ ] A layout test or Playwright check measures band top vs video-controls bottom

## Evidence screenshots

Kept in `screens/T12440/` (delete that folder when this task is archived):

- [rr-14-focus-scrolled-1440.jpg](screens/T12440/rr-14-focus-scrolled-1440.jpg)
- [rr-18-focus-preview-1440.jpg](screens/T12440/rr-18-focus-preview-1440.jpg)
- [rr-40-overlay-start-1440.jpg](screens/T12440/rr-40-overlay-start-1440.jpg)
- [sweep-focus-1024x768.jpg](screens/T12440/sweep-focus-1024x768.jpg)
- [sweep-focus-1920x1080.jpg](screens/T12440/sweep-focus-1920x1080.jpg)
