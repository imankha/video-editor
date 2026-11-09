# T15690: Admin Journey controls and map are clipped on mobile and iPad with no scroll

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: admin on iPhone 14 and iPad gen 7.

**Steps:** Open Admin > Journey on a phone or iPad.

**Expected:** Every control reachable.

**Actual:** At 390 px the control container is overflow:hidden (918 px wide in 340 px): 'Inactive after', Platform pills and Sport pills from 'Rugby' on are unreachable; the map is cut off ('First p...'). iPad: Platform row to 943 px, 'desktop' cut off.

## Acceptance Criteria

- [ ] All Journey controls are reachable (wrap or scroll) at 390 px and 810 px.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\mobile-full-part1.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\mobile-full-part2.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\mobile-journey-fullscreen.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-admin\ipad-admin-full.png`

### Related Tasks
T14720

### Relevant Files (REQUIRED)
- To be found.
