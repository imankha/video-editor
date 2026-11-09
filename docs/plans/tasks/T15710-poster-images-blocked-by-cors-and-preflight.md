# T15710: Poster images blocked by CORS and Preflight 403 errors during load bursts

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Possible bug (unconfirmed), found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, iPhone 14.

**Steps:** Load Home with several games.

**Expected:** Posters load.

**Actual:** Once: /api/games/{1,6,7}/poster.jpg blocked by CORS alongside 'Failed to fetch'. On iPhone, three 'Preflight … 403' console errors in one scan, source unidentified. Not reproduced.

## Acceptance Criteria

- [ ] Reproduce or rule out; posters load without CORS errors on a cold Home load.

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
none

### Relevant Files (REQUIRED)
- To be found.
