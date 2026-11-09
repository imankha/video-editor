# T15630: Sport is asked twice: optional in upload, then a full-screen prompt on every Mark play

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: all.

**Steps:** Upload without picking a sport, then mark plays.

**Expected:** Asked once.

**Actual:** Upload modal 'Sport (for play tags) / Pick a sport' is optional; then each Mark play shows a full-screen 'What sport is this?' until answered ('Skip for now' is a 36 px text link). Play Details also shows a native 'No Sport' dropdown.

## Acceptance Criteria

- [ ] The sport is asked at most once per game, and a skip is remembered for that game.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-upload-filepicked.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-sportmenu.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-play-details.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-08-after-upload-tap-nosport.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-17-markplay2.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-18-after-sport.png`

### Related Tasks
none

### Relevant Files (REQUIRED)
- To be found.
