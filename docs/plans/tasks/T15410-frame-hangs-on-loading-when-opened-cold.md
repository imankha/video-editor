# T15410: Frame hangs on Loading when opened cold from resume, the Continue card or after export

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop 1440x900, iPad portrait (Chromium emulation).

**Steps:** Mid-edit on a play in Frame, close the tab and reopen the app root (or tap the play on Home's 'Continue where you left off' card, or reopen after a Frame export finishes).

**Expected:** Frame loads the play within a few seconds.

**Actual:** URL resumes correctly (/focus/p/1?profile=...) but the screen shows only 'Loading...' for 35-50+ s; on iPad the Mark Plays and Spotlight tabs show lock icons. A manual reload loads it. Log: '[App] editor mode with no selected project; routing home {editorMode: framing}'.

## Acceptance Criteria

- [ ] Cold-loading /focus/p/<id> from a closed tab, from the Continue card, and after an export completes shows the Frame editor within 10 s, no reload needed.

## Context

### Evidence (local screenshots, gitignored)
- `qa/staging-qa-2026-11-09/nuf-desktop/desktop-reopen-root2.png`
- `qa/staging-qa-2026-11-09/nuf-desktop/desktop-midedit.png`
- `qa/staging-qa-2026-11-09/nuf-ipad/ipadP-35-export-end.png`

### Related Tasks
T14980, T15340, T15360 (resume point), T14970 (deep-link cold load)

### Relevant Files (REQUIRED)
- To be found.
