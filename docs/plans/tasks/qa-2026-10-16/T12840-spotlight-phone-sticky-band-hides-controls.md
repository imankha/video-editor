# T12840: Spotlight on phones: the sticky export band hides playback, timeline and settings

**Status:** STAGING
**Impact:** 6
**Complexity:** 4
**Tier:** M (frontend layout, 2-3 files; check guide/drawer overlap)
**Created:** 2026-10-16
**Milestone:** Next build (external QA 2026-10-16). Present on prod, so it does not block the deploy.

## Problem

External QA C04 ([report](../../ux/2026-10-16-external-qa/QA-REPORT.md), screenshot
`screenshots/C04_spotlight_390x844_large-footer.png`, also seen at 430x932, 360x800, 768x1024).
On a phone the Spotlight (Overlay) screen opens with the athlete visible but the play button, timeline
and spotlight settings below the fold; a large fixed band ("Generate highlight with spotlight", the
"Add text" card, "Effects are free, no credits needed") takes most of the remaining height. Scrolling
reaches the controls, so it is not a hard blocker, but most of our parents are on phones.

## Current code

`OverlayModeView.jsx:1360` wraps `ExportButtonView.jsx` (cost note `:249`, copy from
`displayNames.js:496-502` EXPORT_JOBS.overlay) in `sticky bottom-0 z-30`. Same wrapper on prod
(~`:1324`, from T8790/T10820). No open task shrinks it on phones (T8550 mobile CTA sweep is WIP and
broader; T12640 is the Overlay guide placement).

## Solution

On narrow viewports make the band a single compact row (Generate button with the free note as a short
sub-label); move "Add text" into the settings area or a small secondary action. Keep playback directly
under the video. Coordinate with T8550 so the two do not fight over the same band, and keep the guide
coach clear of it (T12800 overlap oracle).

## Acceptance Criteria

- [ ] At 390x844 and 360x800, the video, play button and timeline are all visible without scrolling on first open
- [ ] Generate stays visible without scrolling at every size in the QA matrix
- [ ] Screenshots at 390, 430, 768 and 1440 before and after; no regression at desktop sizes
