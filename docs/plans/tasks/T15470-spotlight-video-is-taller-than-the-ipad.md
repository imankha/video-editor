# T15470: Spotlight video is taller than the iPad portrait screen, controls hidden under the action bar

**Status:** STAGING
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: iPad gen 7 portrait 810x1080 (Chromium emulation).

**Steps:** Frame, export, then open Spotlight (/overlay/p/1) on a Portrait highlight.

**Expected:** Video fits the viewport with its controls visible.

**Actual:** Video element is 728x1294 in a 1080 px viewport; play/step/timeline controls start at y=1463 under the fixed bar; the athlete box is cut off at the bottom.

## Acceptance Criteria

- [ ] On iPad portrait the Spotlight video and its controls fit within the viewport above the action bar.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-39-spotlight.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-40-overlay-export.png`

### Related Tasks
T15400, T14850

### Relevant Files (REQUIRED)
- To be found.
