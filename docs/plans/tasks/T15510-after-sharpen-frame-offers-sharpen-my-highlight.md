# T15510: After Sharpen, Frame offers Sharpen my highlight again with its credit cost, and spends credits with no confirm

**Status:** WIP
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, iPhone 14, iPad.

**Steps:** Sharpen a highlight in Frame and wait for it to finish.

**Expected:** The screen shows it's done and moves on; spending credits is clearly confirmed.

**Actual:** Frame shows 'Sharpen my highlight' and '~8 credits' again (a second tap likely charges 8 more); the only done signal is a toast. The first Sharpen spent 8 credits with no confirm step; the cost is a small grey line ('~8 credits · balance 86').

## Acceptance Criteria

- [ ] After a successful Sharpen the primary button is the next step, not Sharpen again.
- [ ] The credit cost is visible next to the button before the first spend.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-sharpen-click.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-after-sharpen.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-28-after-sharpen.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-29-after-sharpen2.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-38-frame-done.png`

### Related Tasks
T14620, T14830

### Relevant Files (REQUIRED)
- To be found.
