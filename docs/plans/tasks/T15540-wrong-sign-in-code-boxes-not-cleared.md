# T15540: Wrong sign-in code: boxes not cleared and a Verify tap double-submits, burning attempts

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14, iPad, desktop.

**Steps:** Enter a wrong 6-digit code, then type the right one (or tap Verify after the 6th digit).

**Expected:** Boxes clear and refocus after an error; one submit per code.

**Actual:** After 'Invalid code. 3 attempts remaining.' the boxes keep the old digits and focus, so the retry goes into the wrong boxes. Typing 6 digits auto-submits and a Verify tap submits again, burning extra attempts (log and UI counts disagree: 4 vs 3).

## Acceptance Criteria

- [ ] After an invalid code the boxes clear and focus the first box.
- [ ] Each code is submitted exactly once.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-signin-code.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-signin-wrongcode.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-03-wrongcode-typed.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-04-wrongcode-result.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-03-wrongcode.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-03a-wrongcode-typed.png`

### Related Tasks
T15240

### Relevant Files (REQUIRED)
- To be found.
