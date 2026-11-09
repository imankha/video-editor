# T15420: Highlight ready toast opens the Frame result and offers Finish without spotlight after Spotlight was done

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Possible bug (unconfirmed), found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPad portrait (Chromium emulation).

**Steps:** Finish the Spotlight export on a highlight. Tap the stale 'Your highlight is ready / View' toast. Tap the Finish button on the page it opens.

**Expected:** View opens the finished highlight (with spotlight); nothing offers to finish it again without the spotlight.

**Actual:** View opened /focus/p/1 (the Frame result). Its button said 'Finish without spotlight' and started another 'Sharpening your highlight... Saving to library' run (no extra credits). The shared clip then showed no spotlight, so the spotlight may have been dropped. Not confirmed against the earlier overlay output.

## Acceptance Criteria

- [ ] After a Spotlight export, the ready toast's View opens the finished highlight.
- [ ] A finished highlight with a spotlight can't be re-finished without it from a stale toast, and its shared video shows the spotlight.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-45-after-view.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-46-after-finish.png`

### Related Tasks
T14770

### Relevant Files (REQUIRED)
- To be found.
