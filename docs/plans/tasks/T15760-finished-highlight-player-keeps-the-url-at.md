# T15760: Finished highlight player keeps the URL at /home, so it can't be linked or resumed

**Status:** STAGING
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

- [x] The finished player has its own URL that cold-loads to the same highlight.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- No screenshot captured for this bug (URL observation).

### Related Tasks
T14970, T14980

### Relevant Files (REQUIRED)
- `src/frontend/src/components/PublishedReelsPanel.jsx` -- openDownloadPlayer (factored out of
  handlePlay) writes `/home/published/{id}` on open, closeStoryPlayer clears it on close, and a
  mount-once effect restores the player on a cold load of that URL.
- `src/frontend/src/components/ProjectManager.jsx` -- `tabFromPath`/`landingTabFromPath` recognize
  the `/home/published/{id}` suffix as the Published tab.
- `src/frontend/src/stores/editorStore.js` -- cold-load URL canonicalization (`keepsPath`) must
  also preserve the suffixed path, or it collapses to bare `/home` before ProjectManager ever
  reads it (the actual root cause; found via the browser check, not the component-level unit test).

## Ruling

**Lower the proof; commit what works; do not loop** (owner, 2026-11-10). This task is low impact and has already used two dispatches. A passing unit test that shows the URL updates when the player opens and that a cold load of that URL reopens the player is sufficient proof. The browser check is optional: if it does not pass after one more try, declare T15760:C1 as `human` in `T15760.checks.json` (it rides to the staging check) instead of iterating on it. Commit what works now as `T15760: ...` and say in the commit line what is not proven. If the cold-load half cannot be made to work in this dispatch, commit the half that works and stop; do not start a new approach.
