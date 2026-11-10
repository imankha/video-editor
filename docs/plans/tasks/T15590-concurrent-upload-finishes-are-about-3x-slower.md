# T15590: Concurrent upload finishes are about 3x slower than a lone finish

**Status:** WIP
**Impact:** 5
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop.

**Steps:** Finish two different 48 MB uploads at the same time.

**Expected:** No noticeable queueing (T15150).

**Actual:** Alone: finalize 1.7 s, activate 2.9 s. Together: finalize 6.4 s each, activate 8.2 s and 8.8 s; ~15 s of 'Finishing up' after the last byte.

## Acceptance Criteria

- [ ] Two uploads finishing together each complete finalize+activate within 1.5x the lone time.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-upload\desktop-20-upload-tab0.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-upload\desktop-20-upload-tab1.png`

### Related Tasks
T15150, T15030, T15090

### Relevant Files (REQUIRED)
- To be found.
