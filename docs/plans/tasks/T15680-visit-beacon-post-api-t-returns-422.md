# T15680: Visit beacon POST /api/t returns 422 on some page loads

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Possible bug (unconfirmed), found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14 (Chromium emulation).

**Steps:** Load app pages on iPhone emulation and watch POST /api/t.

**Expected:** 204 every time.

**Actual:** The mobile tester saw 422 on every page load; the admin tester saw 204 on an anonymous desktop load. Payload difference not captured.

## Acceptance Criteria

- [ ] Capture the 422 payload; every app page load's beacon returns 204.

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
T7410

### Relevant Files (REQUIRED)
- To be found.
