# T15640: Jump to play lands at the end of the play, and Mark play at 0:00 makes a 2 s play

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPad, desktop.

**Steps:** Tap 'Jump to play' on a 14-22 s play; separately tap Mark play at 0:00.

**Expected:** Jump lands at the play start; an early mark still makes a usable play.

**Actual:** Jump landed at 22 s. Mark at t=0 gave 0:00-0:02 (last 6 s / next 2 s clamped).

## Acceptance Criteria

- [ ] Jump to play seeks to the play's start.
- [ ] Mark play near 0:00 yields a play of the normal 8 s length.

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
none

### Relevant Files (REQUIRED)
- To be found.
