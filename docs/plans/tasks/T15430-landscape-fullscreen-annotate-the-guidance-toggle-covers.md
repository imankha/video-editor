# T15430: Landscape fullscreen Annotate: the Guidance toggle covers the Mark button

**Status:** WIP
**Impact:** 8
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14 landscape 844x390 (Chromium emulation).

**Steps:** Open Annotate on a phone in landscape, tap fullscreen, guidance on. Tap Mark.

**Expected:** Tapping Mark marks a play.

**Actual:** Mark is at x777-841, y6-62; the Guidance toggle at x679-824, y32-76. elementFromPoint at Mark's centre and bottom returns the Guidance toggle, so the tap toggles guidance. Only the sliver right of x824 reaches Mark.

**Second repro (editor version check, e2e-gate@test.local):** Confirmed in the T15370 cockpit with a play selected: Guidance toggle x678-824 y32-76 covers the lower half of Mark/Edit (x777-841 y6-62); a tap at (808,50) hits the toggle.

## Acceptance Criteria

- [ ] In landscape fullscreen Annotate at 844x390, elementFromPoint at Mark's centre returns Mark, and no floating control overlaps it.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-L4-fullscreen.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\mobileL-an-7-fs.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\mobileL-an-10-edit-open.png`

### Related Tasks
T15370 (landscape fullscreen side-strip, in STAGING), T15380

### Relevant Files (REQUIRED)
- To be found.
