# T15570: Resume point never records when the user left or the playhead

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: admin desktop (data).

**Steps:** Admin > user detail 'Where they left off' for qa-*-1109 users.

**Expected:** Shows the age ('… ago') and playhead.

**Actual:** Every resume point has left_at: null and t: null, so neither is shown ('framing, play 1 in "game-ipad", build 7405').

## Acceptance Criteria

- [ ] A resume point saved on exit carries left_at and the playhead t, and admin shows both.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\desktop-user-detail.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\ipad-user-detail.png`

### Related Tasks
T14980, T14990, T15340

### Relevant Files (REQUIRED)
- To be found.
