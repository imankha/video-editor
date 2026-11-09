# T15590: Concurrent upload finishes are about 3x slower than a lone finish

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop.

**Steps:** Finish two different 48 MB uploads at the same time.

**Expected:** No noticeable queueing (T15150).

**Actual:** Alone: finalize 1.7 s, activate 2.9 s. Together: finalize 6.4 s each, activate 8.2 s and 8.8 s; ~15 s of 'Finishing up' after the last byte.

## Acceptance Criteria

- [ ] Two uploads finishing together each complete finalize+activate within 1.5x the lone time.

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
T15150, T15030, T15090

### Relevant Files (REQUIRED)
- To be found.
