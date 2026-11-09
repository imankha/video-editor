# T15600: Under-44px touch targets across sign-in, Annotate, Spotlight, Gallery and the share page

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14, Pixel 5, iPad.

**Steps:** Measure tap targets on each screen.

**Expected:** Every tap target is at least 44x44 px.

**Actual:** Sign-in: email 38 px, Send code/Verify 36 px, 'Send a new code' 90x16, 'Use a different email' 109x16. Annotate: 1x 39x32, play-count chip 51x34, time labels 40x16, fullscreen Mark play 109x32. Plays list: View details/Jump to play 32x32, Hide plays 30x30. Frame: Portrait chip 86x30. Spotlight: number chips 24x24, Delete spotlight 20x20, toast View/Dismiss 30 px. Gallery header 32x28. Share page: Download 63x19, Open ReelBallers 35 px, Tap to unmute 36 px.

## Acceptance Criteria

- [ ] All listed controls are at least 44x44 px on iPhone 14 and iPad.

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
none

### Relevant Files (REQUIRED)
- To be found.
