# T15760: Finished highlight player keeps the URL at /home, so it can't be linked or resumed

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop.

**Steps:** Open a finished highlight in the gallery player; copy the URL or close and reopen.

**Expected:** A deep-linkable URL that resumes to the player.

**Actual:** URL stays /home. 'Get link' first opens a 'Share "Play 1"? ... Create link' confirm; Download looks greyed but works.

## Acceptance Criteria

- [ ] The finished player has its own URL that cold-loads to the same highlight.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- No screenshot captured for this bug (URL observation).

### Related Tasks
T14970, T14980

### Relevant Files (REQUIRED)
- To be found.
