# T15530: Sharpen progress goes silent for the last 20-40 s and gives no time estimate

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, iPhone 14, iPad.

**Steps:** Sharpen an 8 s highlight.

**Expected:** Progress text throughout and a rough time estimate.

**Actual:** 'Sharpening the picture 15%-66%', then 90-110 s with no text; only 'Time remaining varies.' Total 80-115 s for 8 s of video (25 s on iPad run).

**Second repro (editor version check, e2e-gate@test.local):** Sharpen of an 8 s clip took 162 s: 'Making your highlight... 5%' unchanged for the first 62 s, then 'Loading AI model... 12%'. Estimates hidden until 76 s (as T14860 asks), then 'About 3 minutes' / 'About 4 minutes' at 76-78 s against ~86 s actually left (1.6-2x), going 4, 3, 2, 3, 2 minutes (non-monotonic), within ~1.4x only from 85 s. T14860's 'within 1.5x' criterion fails on this one export.

## Acceptance Criteria

- [ ] Progress text is shown until the export completes.
- [ ] A time estimate is shown once frames are flowing.
- [ ] Shown estimates are within 1.5x of the actual remaining time and never go up.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-31-export-0.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-32-export-done.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-ipad\ipadP-32-export-progress.png`

### Related Tasks
T14860

### Relevant Files (REQUIRED)
- To be found.
