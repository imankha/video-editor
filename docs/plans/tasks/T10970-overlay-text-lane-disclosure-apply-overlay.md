# T10970: Overlay Text lane behind a disclosure; "Export" CTA renamed "Apply Overlay"

**Status:** STAGING (merged to master 2026-09-21)
**Impact:** 3
**Complexity:** 1
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Request (user, 2026-09-21)

1. "In Overlay, the Text Layer should be hidden at first (expandable) like we do the segments
   layer in framing."
2. "Also rename 'Export' in Overlay to 'Apply Overlay'."

## Change

**Text lane disclosure.** Mirrors Focus's "Trim and Slo-mo" disclosure (T9950): `OverlayMode`
takes `showTextLane` (default `true`, so existing callers/tests are unchanged) and, when false,
omits the Text lane label + `TextLayer` track and subtracts the lane's 5.25rem from the
playhead-line height. `OverlayModeView` owns the ephemeral state with the same
gesture-override-on-derived-default shape as `advancedOverride`: `textLaneOverride ?? textOverlays.length > 0`,
so a clip that already has text regions opens with the lane visible (never hides existing work)
and a clip without text starts collapsed. A `Text` chevron button (`data-testid="text-lane-disclosure"`)
sits directly under the timeline. No useEffect, nothing persisted. The Text tab's empty-state
copy now says to open Text under the timeline first.

**CTA rename.** `EXPORT_JOBS.overlay.action` is the single source for the Overlay render CTA
and the `export_overlay` quest step title; the backend `quest_config.py` mirrors the title
(guarded by `questDefinitions.test.jsx`), so both were changed together.

## Verification

- `npx vitest run src/modes/overlay/OverlayMode.textLane.test.jsx src/modes/OverlayModeView.textLaneDisclosure.test.jsx src/modes/OverlayModeView.textTabPlayhead.test.jsx src/components/ExportButtonView.test.jsx src/config/questDefinitions.test.jsx src/components/overlay/TextManagementPanel.test.jsx src/modes/OverlayModeView.mobileReachable.test.jsx` -> 7 files, 97 passed.
- Live (dev, fixture account, clip "Good Interception"): CTA reads "Apply Overlay"; the lane
  defaulted open (clip has a text region); clicking `Text` collapsed the lane and the playhead
  line ended at the Highlight lane; clicking again restored it.
