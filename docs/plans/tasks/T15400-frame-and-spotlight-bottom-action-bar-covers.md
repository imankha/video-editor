# T15400: Frame and Spotlight bottom action bar covers the video, crop box, timeline and dialog buttons

**Status:** TODO
**Impact:** 9
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop 1366x660 and 1440x900, iPhone 14 portrait.

**Steps:** Open Frame on a play at 1366x660 (or 1440x900, or iPhone 14 portrait). On iPhone, tap the Portrait shape chip so the 'Switch to landscape?' dialog opens.

**Expected:** The video, crop box, timeline and every dialog button are visible and tappable above the action bar.

**Actual:** The fixed bottom bar (Sharpen my highlight / Trim and slow motion / Preview) is ~226-230 px tall. At 660 px height only a sliver of the video shows and the crop box cannot be dragged; at 1440x900 the timeline/keyframe row and the Overlay video bottom are clipped. On iPhone the bar covers the shape dialog: elementFromPoint at the 'Switch' centre hits the Sharpen bar, and 'Keep portrait' is entirely unreachable.

## Acceptance Criteria

- [ ] At 1366x660, 1440x900 and 390x664 the Frame video and crop box are fully visible and draggable above the action bar.
- [ ] Every button of the 'Switch to landscape?' dialog is tappable on iPhone 14 (elementFromPoint at its centre returns the button).
- [ ] Spotlight/Overlay video and timeline are not clipped by the bar at the same sizes.

## Context

### Evidence (local screenshots, gitignored)
- `qa/staging-qa-2026-11-09/nuf-desktop/short-frame-dribble.png`
- `qa/staging-qa-2026-11-09/nuf-desktop/desktop-frame-step4.png`
- `qa/staging-qa-2026-11-09/nuf-desktop/desktop-spotlight2.png`
- `qa/staging-qa-2026-11-09/nuf-mobile/iphone-26b-shape-expanded.png`
- `qa/staging-qa-2026-11-09/nuf-mobile/iphone-21-frame-g1-full.png`

### Related Tasks
T14850 (Frame and Spotlight on short desktop viewports, in STAGING: this fails it)

### Relevant Files (REQUIRED)
- To be found.
