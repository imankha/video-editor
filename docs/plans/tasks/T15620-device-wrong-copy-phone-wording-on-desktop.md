# T15620: Device-wrong copy: phone wording on desktop and iPad, desktop wording on phones

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, iPad, iPhone.

**Steps:** Read Home guidance, the Upload modal and Frame hints on each device.

**Expected:** Copy matches the device.

**Actual:** Desktop: 'Tap Upload game', 'Don't have the game video on this phone?'. iPad: 'on this phone', 'Optional: rotate your phone for a larger video'. Phone: 'Drop any game video here.'

## Acceptance Criteria

- [ ] No 'phone' wording on desktop/iPad, no 'drop'/'click' wording on touch phones.

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
T14600, T14810

### Relevant Files (REQUIRED)
- To be found.
