# T15600: Under-44px touch targets across sign-in, Annotate, Spotlight, Gallery and the share page

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPhone 14, Pixel 5, iPad.

**Steps:** Measure tap targets on each screen.

**Expected:** Every tap target is at least 44x44 px.

**Actual:** Sign-in: email 38 px, Send code/Verify 36 px, 'Send a new code' 90x16, 'Use a different email' 109x16. Annotate: 1x 39x32, play-count chip 51x34, time labels 40x16, fullscreen Mark play 109x32. Plays list: View details/Jump to play 32x32, Hide plays 30x30. Frame: Portrait chip 86x30. Spotlight: number chips 24x24, Delete spotlight 20x20, toast View/Dismiss 30 px. Gallery header 32x28. Share page: Download 63x19, Open ReelBallers 35 px, Tap to unmute 36 px.

## Acceptance Criteria

- [ ] These ten controls are at least 44x44 px on iPhone 14 and iPad: the five sign-in controls (email field, Send code, Verify, Send a new code, Use a different email), the shared-highlight page's Share and Download this highlight buttons, the REEL BALLERS link, the shared-annotation page's logo link, and Annotate's 1x speed chip. The other listed controls move to a follow-up task.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-02-code-screen.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\pixel5-01-signin.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-14-annotate-noguide.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-34-spotlight-picked.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-41-highlights.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\webkit-45-sharepage.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadL-02-playslist.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-24-frame-aspect.png`

### Related Tasks
none

### Relevant Files (REQUIRED)
- To be found.

## Ruling

**A** (owner, 2026-11-12): fix rounds ran out because the check proves ten of about twenty listed controls. Narrow C1 to those ten and land; the other eleven (Annotate play-count chip, time labels, Mark play; Plays-list View details, Jump to play, Hide plays; Frame Portrait chip; Spotlight number chips, Delete spotlight, toast View/Dismiss; Gallery header; Open ReelBallers; Tap to unmute) are a follow-up task. Verify budget raised to 75 min for this group.
