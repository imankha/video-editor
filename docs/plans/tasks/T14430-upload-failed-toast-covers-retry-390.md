# T14430: Failed upload at 390: the "Upload stopped" toast covers Retry upload and the guide shows a false "Scroll up to continue"

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Tier:** S (frontend)
**Created:** 2026-11-02
**Updated:** 2026-11-02
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-11-02 ([RESULTS.md section 12](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots (staging, 2026-11-02):

- [r4-annotate-upload-failed-390.png](../ux/2026-10-11-guide-coverage-sweep/screens/r4-annotate-upload-failed-390.png): the failure: toast over the banner and Retry upload, "Scroll up to continue" pill, card docked at the bottom
- [r4-annotate-upload-failed-1440.png](../ux/2026-10-11-guide-coverage-sweep/screens/r4-annotate-upload-failed-1440.png): the passing reference: Retry upload pulsing, banner clear, card 12 px away

Repro: upload a new game with every PUT to `*.r2.cloudflarestorage.com` aborted (the file must be new to R2, or dedup skips the PUT). No credits are charged.

## Problem

T13390 holds at 1440, 1024 and 768: the guide says "Your game didn't finish uploading. Tap Retry upload to try again.", pulses Retry upload, and keeps the failure banner clear. At 390x844:

- The upload toast ("t13390... Upload stopped / Part 1 network error") is pinned to the top of the screen, directly over the red failure banner, and covers most of the pulsing Retry upload button (x 256, y 89, 109x24).
- Because a page element covers the anchor's centre, the guide treats the anchor as hidden: it shows "Scroll up to continue" (the page is already at the top, so scrolling does nothing) and docks the card at the bottom, 593 px from the anchor.

A parent on a phone sees an error toast, a pill telling them to scroll and a card that names a button they cannot see.

## Solution

On phones, keep the failure toast from covering the banner (move it, or drop it while the banner, which already offers Retry upload, is on screen). The guide's pill should never say "scroll" when scrolling cannot reveal the anchor.

## Context

### Relevant Files
- `src/frontend/src/components/UploadingGameTile.jsx`, `src/frontend/src/services/uploadManager.js` (the failure toast)
- `src/frontend/src/components/instructions/FloatingCoach.jsx` (`coveredByPage`, the scroll hint direction)
- `src/frontend/src/components/instructions/resolveGuide.js` (`annotate.upload-failed`)

### Related Tasks
- Follow-up of T13390 and T13010; found by T12590

## Acceptance Criteria

- [ ] At 390x844 with the open game's upload failed, Retry upload on the banner is fully visible and tappable
- [ ] No "Scroll up/down to continue" pill on that state; the card sits within 250 px of Retry upload without covering it
- [ ] 1440, 1024 and 768 still pass
