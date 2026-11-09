# T15610: Guidance overlay bugs: offset cutout, blocks input, step count changes, floats over headers

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-09
**Updated:** 2026-11-09

## Problem

Bug, found by the 2026-11-09 Playwright QA pass on staging (new-user flow + version check, desktop / iPhone 14 / iPad gen 7).
Viewports: desktop, iPhone 14, iPad.

**Steps:** New account, guidance on, walk Home, Upload, Frame, Spotlight.

**Expected:** Cutout on its target, step counts stable, the toggle never covers controls.

**Actual:** Home 'Upload game' cutout ~100 px left of the button while 'Connecting...'. guide-shade intercepts clicks (e.g. 'More options' during Frame step 2 of 5). Frame guide says 'Step 1 of 6' then 'Step 2 of 5'. The Guidance toggle floats over the Upload modal title, Frame header (crop icon, credits chip) and Spotlight header; cards cover the video and the dropzone. Spotlight guide disappears after the first tap ('Tap 2 (now)' has no instruction).

## Acceptance Criteria

- [ ] Cutout aligns with its target after load.
- [ ] Frame guide step total is constant.
- [ ] The Guidance toggle overlaps no control on any screen at the three viewports.

## Context

### Evidence (local only: `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09`, gitignored, not in git)
Repo-relative: `qa/staging-qa-2026-11-09/`. Tester brief (accounts, viewports, how codes were read): `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\QA-BRIEF.md`.
Test accounts on staging: `imankh+qa-{desktop,mobile,ipad,upload}-1109@gmail.com` (new users), `e2e-gate@test.local` (editor checks; game 3, projects 9-13), admin `imankh@gmail.com`.

- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-home-new.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-home-guided2.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-desktop\desktop-frame1.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-07-upload-modal.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-21-frame-g0.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-35-spot-1.png`
- `C:\Users\imank\projects\video-editor\qa\staging-qa-2026-11-09\nuf-mobile\iphone-35-spot-2.png`

### Related Tasks
T14760

### Relevant Files (REQUIRED)
- To be found.
