# T15730: Frame on a play from a game still uploading says Video format not supported and keeps Sharpen enabled

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop.

**Steps:** Make highlight on a play from a game whose upload is stuck in 'uploading' (e2e-gate@test.local game 2, project 10).

**Expected:** A message that the game is still uploading; Sharpen/Trim/Preview disabled until the video exists.

**Actual:** `.../clips/projects/10/clips/10/stream` and `/playback-url` return 409, but the screen says 'We couldn't load this video / Video format not supported'. Sharpen, Trim and Preview stay enabled with no working video.

## Acceptance Criteria

- [ ] A 409 from stream/playback-url shows an 'still uploading' message, not a format error.
- [ ] Sharpen is not offered while the source video is unavailable.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\desktop-f-4-frame-p10.png`

### Related Tasks
T14540

### Relevant Files (REQUIRED)
- To be found.
