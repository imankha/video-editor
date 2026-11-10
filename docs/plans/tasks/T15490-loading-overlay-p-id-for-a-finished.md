# T15490: Loading /overlay/p/<id> for a finished project redirects to Frame and spins on Loading

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop 1440x900.

**Steps:** Reload or deep-link /overlay/p/2 for a project whose highlight is already finished.

**Expected:** Spotlight screen (or the finished highlight) opens.

**Actual:** Redirects to /focus/p/2, spins on 'Loading...' and toasts 'Make your highlight first, then add a spotlight.' Console: '[OverlayScreen] No video source available', 'No working video URL in project data {projectId:2, workingVideoId:null}'.

## Acceptance Criteria

- [ ] A cold load of /overlay/p/<id> for a finished project opens without a Loading hang or a misleading toast.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\short-overlay.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\desktop-n-overlay-nowv.png`

### Related Tasks
T14970, T15260 (deep links), T15340

### Relevant Files (REQUIRED)
- To be found.
