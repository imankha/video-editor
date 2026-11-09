# T15430: Landscape fullscreen Annotate: the Guidance toggle covers the Mark button

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14 landscape 844x390 (Chromium emulation).

**Steps:** Open Annotate on a phone in landscape, tap fullscreen, guidance on. Tap Mark.

**Expected:** Tapping Mark marks a play.

**Actual:** Mark is at x777-841, y6-62; the Guidance toggle at x679-824, y32-76. elementFromPoint at Mark's centre and bottom returns the Guidance toggle, so the tap toggles guidance. Only the sliver right of x824 reaches Mark.

## Acceptance Criteria

- [ ] In landscape fullscreen Annotate at 844x390, elementFromPoint at Mark's centre returns Mark, and no floating control overlaps it.

## Context

### Evidence (local screenshots, gitignored)
- `qa/staging-qa-2026-11-09/nuf-mobile/iphone-L4-fullscreen.png`

### Related Tasks
T15370 (landscape fullscreen side-strip, in STAGING), T15380

### Relevant Files (REQUIRED)
- To be found.
