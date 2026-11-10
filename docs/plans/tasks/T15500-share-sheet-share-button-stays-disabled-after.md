# T15500: Share sheet: Share button stays disabled after the link is created, oversized buttons on mobile

**Status:** WIP
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

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-42-share-sheet.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-42b-link-ready.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-43-after-share.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-55-share.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-56-share-anyone.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-57-share-done.png`

### Related Tasks
T15070

### Relevant Files (REQUIRED)
- To be found.
