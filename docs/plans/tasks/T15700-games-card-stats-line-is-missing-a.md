# T15700: Games card stats line is missing a label between the dots

**Status:** STAGING
**Impact:** 3
**Complexity:** 1
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14.

**Steps:** Look at a game card on Home after marking plays and finishing one.

**Expected:** Every number has a label.

**Actual:** '4 plays •  2 • 1 finished'.

## Acceptance Criteria

- [ ] Every count on the game card has its label.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- No screenshot captured for this bug (the tester read the card text but no screenshot shows that card; open Home > Games as imankh+qa-mobile-1109@gmail.com (4 plays, 1 finished) to see it).

### Related Tasks
none

### Relevant Files (REQUIRED)
- To be found.
