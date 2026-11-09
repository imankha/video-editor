# T15460: Landscape Annotate outside fullscreen is unusable on a phone, and wastes space on iPad

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14 landscape 844x390; iPad gen 7 landscape.

**Steps:** Open Annotate in landscape without fullscreen.

**Expected:** Video and Mark play are visible without scrolling.

**Actual:** Phone: plays list takes the left third ('Show plays for' wraps), video at y121-351, play controls start at y360 and 'Mark play' sits at y388 of 390 even with the pane scrolled to max. iPad: the video is only 490x275 in a wide black panel (~34% of screen height).

## Acceptance Criteria

- [ ] At 844x390 non-fullscreen Annotate, Mark play is fully on screen without scrolling.
- [ ] On iPad landscape the video uses most of the available height.

## Context

### Evidence (local screenshots, gitignored)
- `qa/staging-qa-2026-11-09/nuf-mobile/iphone-L1-annotate.png`
- `qa/staging-qa-2026-11-09/nuf-mobile/iphone-L2-annotate-noguide.png`
- `qa/staging-qa-2026-11-09/nuf-mobile/iphone-L3-scrolled.png`

### Related Tasks
T15370, T15380

### Relevant Files (REQUIRED)
- To be found.
