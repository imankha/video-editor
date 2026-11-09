# T15500: Share sheet: Share button stays disabled after the link is created, oversized buttons on mobile

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14, iPad.

**Steps:** Open Share on a highlight, choose 'Anyone with the link'.

**Expected:** Once the link exists, the next action is obvious and enabled (copy/share).

**Actual:** The link fills in (after ~3 s of spinner) but the Share button stays disabled for 30+ s. Share and Cancel are ~108 px tall (min-h-[108px]), Cancel half-width; the 'Anyone with the link' pill touches the container edge.

## Acceptance Criteria

- [ ] After 'Anyone with the link' creates a link, a copy/share action is enabled within 3 s.
- [ ] Share/Cancel buttons are normal height on mobile.

## Context

### Evidence (local screenshots, gitignored)
- `qa/staging-qa-2026-11-09/nuf-mobile/iphone-42-share-sheet.png`
- `qa/staging-qa-2026-11-09/nuf-mobile/iphone-42b-link-ready.png`
- `qa/staging-qa-2026-11-09/nuf-ipad/ipadP-56-share-anyone.png`

### Related Tasks
T15070

### Relevant Files (REQUIRED)
- To be found.
