# T15480: Finished highlight is hard to find: Finish lands on an empty screen and Highlights shows only locked reels

**Status:** WIP
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, iPhone 14, iPad.

**Steps:** Finish a highlight (Spotlight done). Look for it afterwards.

**Expected:** Finish lands where the new highlight is visible; the Highlights tab lists it.

**Actual:** Finish goes to /home/published showing 'Highlights 0' until you navigate again; a cold load of /home/published redirects to /home/games. The Highlights tab shows two locked reels ('Add more highlights to unlock this game's highlight reel 8s / 30s', 'Your top-rated highlights, once you have enough') and the new clip is not obviously listed. On iPad the 'Just finished' section vanished on reload.

## Acceptance Criteria

- [ ] After Finish, the new highlight is visible on the landing screen without re-navigation.
- [ ] The Highlights tab lists each finished highlight above locked reel tiles.
- [ ] Cold-loading /home/published shows published highlights.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-home-reels.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-after-finish.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-finish-panel.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-39-finish.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-40-published.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-41-highlights.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-44-highlights.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-47-gallery.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-50-gallery.png`

### Related Tasks
T14770 (list of highlights made)

### Relevant Files (REQUIRED)
- To be found.
