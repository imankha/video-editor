# T15640: Jump to play lands at the end of the play, and Mark play at 0:00 makes a 2 s play

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPad, desktop.

**Steps:** Tap 'Jump to play' on a 14-22 s play; separately tap Mark play at 0:00.

**Expected:** Jump lands at the play start; an early mark still makes a usable play.

**Actual:** Jump landed at 22 s. Mark at t=0 gave 0:00-0:02 (last 6 s / next 2 s clamped).

## Acceptance Criteria

- [ ] Jump to play seeks to the play's start.
- [ ] Mark play near 0:00 yields a play of the normal 8 s length.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadL-02-playslist.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadL-03-after-jump.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-mark1.png`

### Related Tasks
none

### Relevant Files (REQUIRED)
- To be found.
