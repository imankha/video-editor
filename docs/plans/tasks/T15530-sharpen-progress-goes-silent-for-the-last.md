# T15530: Sharpen progress goes silent for the last 20-40 s and gives no time estimate

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, iPhone 14, iPad.

**Steps:** Sharpen an 8 s highlight.

**Expected:** Progress text throughout and a rough time estimate.

**Actual:** 'Sharpening the picture 15%-66%', then 90-110 s with no text; only 'Time remaining varies.' Total 80-115 s for 8 s of video (25 s on iPad run).

## Acceptance Criteria

- [ ] Progress text is shown until the export completes.
- [ ] A time estimate is shown once frames are flowing.

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
T14860

### Relevant Files (REQUIRED)
- To be found.
