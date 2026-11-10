# T15750: Phone portrait fullscreen with Edit play open shrinks the picture to a 114x64 thumbnail

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14 portrait.

**Steps:** Annotate fullscreen in portrait, tap Edit play.

**Expected:** The picture stays large enough to judge a trim.

**Actual:** The editor sheet fills the screen and the picture is 114x64 px (~3% of the screen); it also starts playing when Edit play is tapped. Technically 0% covered (T15380 passes) but unusable for trimming.

## Acceptance Criteria

- [ ] With Edit play open in portrait fullscreen, the picture is at least 50% of the screen width.
- [ ] Opening Edit play does not start playback.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\mobileP-an-5-fs-editopen.png`

### Related Tasks
T15380

### Relevant Files (REQUIRED)
- To be found.
