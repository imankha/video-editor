# T15710: Poster images blocked by CORS and Preflight 403 errors during load bursts

**Status:** STAGING
**Impact:** 4
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Possible bug (unconfirmed), found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, iPhone 14.

**Steps:** Load Home with several games.

**Expected:** Posters load.

**Actual:** Once: /api/games/{1,6,7}/poster.jpg blocked by CORS alongside 'Failed to fetch'. On iPhone, three 'Preflight … 403' console errors in one scan, source unidentified. Not reproduced.

## Acceptance Criteria

- [ ] Reproduce or rule out; posters load without CORS errors on a cold Home load.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- No screenshot captured for this bug (seen once each in console logs, not reproduced; the editor tester saw WebKit 'Preflight ... 403' on video requests too, see T15720).

### Related Tasks
none

### Relevant Files (REQUIRED)
- To be found.
