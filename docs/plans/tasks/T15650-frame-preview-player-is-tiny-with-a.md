# T15650: Frame preview player is tiny with a clipped time readout, and the timeline zoom pill is clipped on iPad

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop 1440x900, iPad portrait.

**Steps:** Open the Frame preview; on iPad look at the timeline zoom control.

**Expected:** Preview is a usable size; controls not clipped.

**Actual:** Preview ~165 px wide, time reads '00:00:...'. iPad: the '100%' zoom pill sits half behind the video control bar (~y=1475).

## Acceptance Criteria

- [ ] Frame preview is at least half the editor width with a readable time.
- [ ] The zoom pill is fully visible on iPad portrait.

## Context

### Evidence (local screenshots, gitignored)
- `qa/staging-qa-2026-11-09/nuf-desktop/desktop-frame-preview.png`
- `qa/staging-qa-2026-11-09/nuf-ipad/ipadP-30-b.png`

### Related Tasks
none

### Relevant Files (REQUIRED)
- To be found.
