# T15580: Impersonation banner has no Reopen their page link for some users

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: admin desktop.

**Steps:** Admin > Users, impersonate qa-desktop-1109 (resume point /overlay/p/2, profile_id null).

**Expected:** Banner shows 'Reopen their page' for the whole session.

**Actual:** App lands on /overlay/p/2 but the banner shows only 'Stop impersonating'; rb_impersonation_landing_point not set. Works for qa-mobile-1109 (/focus/p/1).

## Acceptance Criteria

- [ ] Impersonating any user with a resume point shows 'Reopen their page'.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\desktop-impersonating.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\desktop-imp-qa-mobile.png`: working case for comparison

### Related Tasks
T14990

### Relevant Files (REQUIRED)
- To be found.
