# T15670: Journey map in full screen is wider than 1440 px and cuts off the first stages

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: admin desktop 1440x900.

**Steps:** Admin > Journey, expand all groups, Full screen.

**Expected:** All stages visible without horizontal scrolling (T14730).

**Actual:** Flow is 1517 px wide starting at x=-101; 'Opened upload' and 'Picked a file' cut off.

## Acceptance Criteria

- [ ] Full-screen Journey with all groups expanded fits 1440 px.

## Context

### Evidence (local screenshots, gitignored)
- `qa/staging-qa-2026-11-09/vc-admin/desktop-journey-fullscreen.png`

### Related Tasks
T14730, T14800

### Relevant Files (REQUIRED)
- To be found.
