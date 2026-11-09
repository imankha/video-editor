# T15400: Frame and Spotlight bottom action bar covers the video, crop box, timeline and dialog buttons

**Status:** TODO
**Impact:** 9
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop 1366x660 and 1440x900, iPhone 14 portrait.

**Steps:** Open Frame on a play at 1366x660 (or 1440x900, or iPhone 14 portrait). On iPhone, tap the Portrait shape chip so the 'Switch to landscape?' dialog opens.

**Expected:** The video, crop box, timeline and every dialog button are visible and tappable above the action bar.

**Actual:** The fixed bottom bar (Sharpen my highlight / Trim and slow motion / Preview) is ~226-230 px tall. At 660 px height only a sliver of the video shows and the crop box cannot be dragged; at 1440x900 the timeline/keyframe row and the Overlay video bottom are clipped. On iPhone the bar covers the shape dialog: elementFromPoint at the 'Switch' centre hits the Sharpen bar, and 'Keep portrait' is entirely unreachable.

**Second repro (editor version check, e2e-gate@test.local):** Spotlight `/overlay/p/12?profile=9fa7378c` at 1440x900: video 270x480 (y209-689), controls row y=697, action bar starts y=680, so 'Play highlight', 'Play spotlight' and the step buttons fail the hit test; at 1366x660 bar y=440, controls y=537. Frame `/focus/p/11?profile=9fa7378c` at 1366x660 (guidance dismissed): video 569x320 but only ~229 px visible (y199-428), Play (y=527) hit-tests to 'Sharpen my highlight', box handles cut off, page does not scroll. 1280x800 passes (the only size T14850 fixed).

## Acceptance Criteria

- [ ] At 1366x660, 1440x900 and 390x664 the Frame video and crop box are fully visible and draggable above the action bar.
- [ ] Every button of the 'Switch to landscape?' dialog is tappable on iPhone 14 (elementFromPoint at its centre returns the button).
- [ ] Spotlight/Overlay video and timeline are not clipped by the bar at the same sizes.
- [ ] Spotlight transport buttons (Play highlight, Play spotlight, step) pass a hit test at 1440x900 and 1366x660.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\short-frame-dribble.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-frame-step4.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-spotlight2.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-26b-shape-expanded.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-21-frame-g1-full.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\desktop-z-ov12b.png`: Spotlight at 1440x900, transport row under the bar
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\short-z-frame11-noguide.png`: Frame at 1366x660, Play hit-tests to the Sharpen bar
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\vc-editor\d1280-z-overlay12.png`: 1280x800 for comparison (passes)

### Related Tasks
T14850 (Frame and Spotlight on short desktop viewports, in STAGING: this fails it)

### Relevant Files (REQUIRED)
- To be found.
