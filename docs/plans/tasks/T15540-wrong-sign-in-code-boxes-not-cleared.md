# T15540: Wrong sign-in code: boxes not cleared and a Verify tap double-submits, burning attempts

**Status:** STAGING
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
- [ ] The T15540 browser check passes on a cold stack: the first sign-in screen wait tolerates a cold page compile (up to 90 s), and a failure names the locator that timed out.

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

## Ruling

**B** (owner, 2026-11-12): the VERIFY_NEEDS_USER stop on T15540:C1/C2 is treated as a cold-start flake, not a code defect (passed 6 of 8 runs; both failures followed a 240 s stack warm-up timeout). Harden the check (C3) rather than accept the unverified criteria; staging is cold often and the owner does not want to keep dealing with this. Verify budget raised to 60 min for this group.
