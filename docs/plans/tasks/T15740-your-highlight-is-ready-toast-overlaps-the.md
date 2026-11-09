# T15740: Your highlight is ready toast overlaps the action bar and the chat bubble

**Status:** WIP
**Impact:** 3
**Complexity:** 1
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop 1366x660 and 1280x800.

**Steps:** Finish an export and stay on Frame or Spotlight.

**Expected:** The toast's View/Dismiss are fully tappable.

**Actual:** The toast sits over the action bar and its Dismiss is partly under the chat bubble. Also re-shown on every reload (mobile tester).

## Acceptance Criteria

- [ ] The toast never overlaps the action bar or the chat bubble.
- [ ] A dismissed toast stays dismissed after reload.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\short-z-frame11.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\d1280-z-overlay12.png`

### Related Tasks
T15420

### Relevant Files (REQUIRED)
- To be found.
