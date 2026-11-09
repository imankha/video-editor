# T15540: Wrong sign-in code: boxes not cleared and a Verify tap double-submits, burning attempts

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14, iPad, desktop.

**Steps:** Enter a wrong 6-digit code, then type the right one (or tap Verify after the 6th digit).

**Expected:** Boxes clear and refocus after an error; one submit per code.

**Actual:** After 'Invalid code. 3 attempts remaining.' the boxes keep the old digits and focus, so the retry goes into the wrong boxes. Typing 6 digits auto-submits and a Verify tap submits again, burning extra attempts (log and UI counts disagree: 4 vs 3).

## Acceptance Criteria

- [ ] After an invalid code the boxes clear and focus the first box.
- [ ] Each code is submitted exactly once.

## Context

### Evidence (local screenshots, gitignored)
- none

### Related Tasks
T15240

### Relevant Files (REQUIRED)
- To be found.
