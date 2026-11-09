# T15660: Share end card wordmark is broken and Make your own highlights links to prod from staging

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, mobile.

**Steps:** Watch a shared highlight to the end on staging.

**Expected:** Clean wordmark; links point at the current environment.

**Actual:** 'Reel' above and 'Ballers' below-right of the logo. 'Make your own highlights' goes to www.reelballers.com (prod) while 'Open ReelBallers' goes to the staging app (both carry ref, sport, utm_source=share_endcard). The prod link may be by design.

## Acceptance Criteria

- [ ] Wordmark renders on one line with the logo.
- [ ] On staging, end-card links stay on staging (or the task records that prod is intended).

## Context

### Evidence (local screenshots, gitignored)
- `qa/staging-qa-2026-11-09/nuf-desktop/desktop-share-end.png`

### Related Tasks
T15070

### Relevant Files (REQUIRED)
- To be found.
