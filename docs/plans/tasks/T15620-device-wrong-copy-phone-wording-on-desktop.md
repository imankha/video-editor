# T15620: Device-wrong copy: phone wording on desktop and iPad, desktop wording on phones

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, iPad, iPhone.

**Steps:** Read Home guidance, the Upload modal and Frame hints on each device.

**Expected:** Copy matches the device.

**Actual:** Desktop: 'Tap Upload game', 'Don't have the game video on this phone?'. iPad: 'on this phone', 'Optional: rotate your phone for a larger video'. Phone: 'Drop any game video here.'

## Acceptance Criteria

- [ ] No 'phone' wording on desktop/iPad, no 'drop'/'click' wording on touch phones.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-home-new.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-upload\desktop-12-modal-expanded.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-08-modal-noguide.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-09-nogamefile.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-06-upload-modal.png`

### Related Tasks
T14600, T14810

### Relevant Files (REQUIRED)
- To be found.
