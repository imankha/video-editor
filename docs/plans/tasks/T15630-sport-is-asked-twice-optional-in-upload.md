# T15630: Sport is asked twice: optional in upload, then a full-screen prompt on every Mark play

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: all.

**Steps:** Upload without picking a sport, then mark plays.

**Expected:** Asked once.

**Actual:** Upload modal 'Sport (for play tags) / Pick a sport' is optional; then each Mark play shows a full-screen 'What sport is this?' until answered ('Skip for now' is a 36 px text link). Play Details also shows a native 'No Sport' dropdown.

## Acceptance Criteria

- [ ] The sport is asked at most once per game, and a skip is remembered for that game.

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
none

### Relevant Files (REQUIRED)
- To be found.
