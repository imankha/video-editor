# T14630: Spotlight copy

**Status:** WIP
**Impact:** 6
**Complexity:** 4
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

In Spotlight the circle on the athlete is called a "highlight" ("Click to highlight", "Disable
highlight layer", "Drag the highlight ellipse", "Highlight Region N", settings panel "Highlight"),
a region, a layer and "player boxes". Lock and warning copy says "overlays", "Generate required
for Spotlight mode", "Highlight boundaries changed since this video's Focus export. Overlay
edits will apply to the old crop." with a "Re-run Focus" button. Text controls say element,
block, region, preset, "Shadow blur", "Stroke width". Cover copy says "cover frame", "marker",
"Use a frame instead". "Click" appears in phone-visible instructions.

Task 4 of 8 in the [Copy Vocabulary epic](EPIC.md). Read EPIC.md for the glossary, verbs and
style rules. Prior tasks: T14600, T14610, T14620 (the paid step is now "Sharpen my highlight"; "Make highlight" starts a highlight).

## Solution

- The circle is always **spotlight**: "Tap your athlete to add a spotlight", "Turn spotlight off/on", "Spotlight 1", "Delete spotlight".
- Lock copy: "Make your highlight first, then add a spotlight."
- Stale-framing warning: "You changed this play's start or end after framing. Your spotlight still uses the old framing." Button: "Redo framing".
- Text: "Delete text", "Hide text", "Select text to edit it", "Shadow softness", "Outline thickness", "Alignment"; no "preset".
- Cover: "cover", "Use a still from the video", "Drag to pick the cover people see before they press play."
- "athlete" for the parent's kid in the picker; "Finding athletes..." (no tracking claims; T14520 removed "tracking").
- "Dim outside" for both dim controls (Spotlight "Dim background" and Frame "Darken outside the box" use one phrase).
- Style rules throughout.

## Context

### Relevant Files
- `src/frontend/src/modes/OverlayModeView.jsx`, `src/frontend/src/screens/OverlayScreen.jsx`, `src/frontend/src/containers/OverlayContainer.jsx`
- `src/frontend/src/modes/overlay/**` (OverlayMode, OverlayTimeline, layers/HighlightLayer, layers/DetectionMarkerLayer, layers/PosterMarkerLayer, overlays/PlayerDetectionOverlay, overlays/HighlightOverlay)
- `src/frontend/src/components/timeline/RegionLayer.jsx`, `TextLayer.jsx`, `components/settings/**` (OverlaySpotlightPanel, FocusSettingsPanel, ThumbnailPanel, TextManagementPanel), `components/textspec/**`, `PositionPresetGrid.jsx`, `ModeSwitcher.jsx` (hardcoded descriptions)
- `src/frontend/src/stores/overlayActionStore.js` (save-failure copy)
- `src/frontend/src/config/displayNames.js` (EDITOR_PANELS, OVERLAY_*, GUIDE.overlay*, TEXT_*)

Findings with lines: [audit/D-modes-screens-logic.md](audit/D-modes-screens-logic.md) F-07, F-10, F-11, F-19 to F-21, F-49, F-50; [audit/C-components-MZ.md](audit/C-components-MZ.md) 2, 27-39; [audit/A-catalog.md](audit/A-catalog.md) C19, I70, I71; [audit/F-gapfill.md](audit/F-gapfill.md) F1, F10.

## Implementation

1. [ ] Failing tests: no "highlight" for the circle (timeline toggle, region label, settings panel title); stale-framing warning copy
2. [ ] Change strings; move inline strings to displayNames
3. [ ] Update unit + e2e selectors
4. [ ] Relevant tests + explicit lint; phone screenshot of Spotlight with a spotlight and text placed

## Acceptance Criteria

- [ ] "highlight" never names the circle; "region", "layer", "ellipse", "element", "preset", "overlay", "Focus" gone from Spotlight copy
- [ ] Tests pass
