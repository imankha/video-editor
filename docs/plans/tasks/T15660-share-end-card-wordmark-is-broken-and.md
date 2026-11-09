# T15660: Share end card wordmark is broken and Make your own highlights links to prod from staging

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, mobile.

**Steps:** Watch a shared highlight to the end on staging.

**Expected:** Clean wordmark; links point at the current environment.

**Actual:** 'Reel' above and 'Ballers' below-right of the logo. 'Make your own highlights' goes to www.reelballers.com (prod) while 'Open ReelBallers' goes to the staging app (both carry ref, sport, utm_source=share_endcard). The prod link may be by design.

**Second repro (editor version check, e2e-gate@test.local):** End card in phone landscape is small with the logo overlapping 'Reel'/'Ballers'. CTAs carry `?ref=55cf2d11&sport=soccer&utm_source=share_endcard&utm_medium=viral&utm_campaign=reel_endcard`; 'Make your own highlights' goes to www.reelballers.com, 'Open ReelBallers' to the app.

## Acceptance Criteria

- [ ] Wordmark renders on one line with the logo.
- [ ] On staging, end-card links stay on staging (or the task records that prod is intended).

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-share-end.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-46-endcard.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-61-shared-end.png`

### Related Tasks
T15070

### Relevant Files (REQUIRED)
- To be found.
