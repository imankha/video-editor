# T15670: Journey map in full screen is wider than 1440 px and cuts off the first stages

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: admin desktop 1440x900.

**Steps:** Admin > Journey, expand all groups, Full screen.

**Expected:** All stages visible without horizontal scrolling (T14730).

**Actual:** Flow is 1517 px wide starting at x=-101; 'Opened upload' and 'Picked a file' cut off.

## Acceptance Criteria

- [ ] Full-screen Journey with all groups expanded fits 1440 px.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\desktop-journey-fullscreen.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\desktop-journey-expanded.png`

### Related Tasks
T14730, T14800

### Relevant Files (REQUIRED)
- To be found.
