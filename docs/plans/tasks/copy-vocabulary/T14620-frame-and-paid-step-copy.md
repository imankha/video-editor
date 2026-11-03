# T14620: Frame and the paid step copy

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

The Frame step has four names (Framing, Frame, Focus, Crop), and the button that opens it says
"Make highlight". Inside, the rectangle is a "crop box", each placement a "focus point",
"keyframe", "spot" or "box"; timeline copy says segment, boundary, split, detrim, "Pan/Zoom
mode", "Crop mode", "Setup". The paid AI step is "Generate highlight" on the button, "Export
complete!" when it finishes (5 places, contradicting the "Highlight ready" constants),
"Generation failed" on error, plus Create / Render / Rebuild / Re-generate elsewhere. The
length tooltip says "billed"; a crop warning says "AI upscaler works best with 4x scaling".

Task 3 of 8 in the [Copy Vocabulary epic](EPIC.md). Read EPIC.md for the glossary, verbs and
style rules. Prior tasks: T14600 (glossary reference, tabs), T14610 (Mark plays copy).

## Solution (user decision D3)

- Button that opens Frame: **Frame play**; in-progress: **Continue framing**. Header tab stays "Frame".
- The paid step: **Make highlight** everywhere (button, cost line, credit modal). Progress
  "Making your highlight...", done "Your highlight is ready" (read the `EXPORT_JOBS` completed
  constants instead of the hardcoded "Export complete!").
- Rectangle **box**; placements **positions** ("Add position", "Delete position", "Copy position").
- Trim / slow motion / section; drop "Pan/Zoom mode" and "Crop mode" ("Move the video" / "Move the box").
- "Check framing" for the pre-paid preview; "Watch" after.
- Length tooltip: "Length of your highlight. Credits are based on this."; crop warning: "This box is very tight, so the sharpened video may look softer. Try a slightly wider box."
- Remove every remaining "Focus" in Frame copy.
- Style rules throughout.

## Context

### Relevant Files
- `src/frontend/src/modes/FocusModeView.jsx`, `src/frontend/src/containers/FocusContainer.jsx` (toast wording only; raw-error removal is T14530), `src/frontend/src/screens/FocusScreen.jsx`
- `src/frontend/src/modes/focus/**` (FocusCockpit, CockpitTimelineStrip, FocusTimeline, SegmentLayer, overlays/CropOverlay, TrimTimeField)
- `src/frontend/src/containers/ExportButtonContainer.jsx`, `src/frontend/src/components/ExportButtonView.jsx`, `GlobalExportIndicator.jsx`, `FocusPublishActionBar.jsx`, `FramedBanner.jsx`, `FramingHeaderStatus.jsx`, `CropControls.jsx` (check whether still mounted), `KeyframeMarker.jsx`, `SegmentedProgressStrip.jsx`, `stores/exportStore.js`
- `src/frontend/src/config/displayNames.js` (ANNOTATE.MAKE_HIGHLIGHT*, FOCUS_*, EXPORT_JOBS, EXPORT_PROGRESS, CREDITS, EDITOR_PANELS, GUIDE.focus*)
- `src/frontend/src/modes/annotate/components/HighlightOrientationSlots.jsx` (stop the regex rewrite of Title Case constants; store sentence case)

Findings with lines: [audit/A-catalog.md](audit/A-catalog.md) B9-B14, C15-C22, F35-F45; [audit/D-modes-screens-logic.md](audit/D-modes-screens-logic.md) F-04, F-05, F-23 to F-28, F-71, F-72; [audit/C-components-MZ.md](audit/C-components-MZ.md) 13-16, 34; [audit/F-gapfill.md](audit/F-gapfill.md) F3.

### Technical Notes
- "Make highlight" currently names the Frame-opening button; do the Frame play rename and the paid-step rename in the same change so the two never share a label.
- Credit history row labels ("Video generation") are T14640.

## Implementation

1. [ ] Failing tests: Frame-opening button reads "Frame play"; paid button reads "Make highlight"; completion text is "Your highlight is ready" (no "Export complete!")
2. [ ] Change strings; move inline strings to displayNames
3. [ ] Update unit + e2e selectors
4. [ ] Relevant tests + explicit lint; phone + desktop screenshots of Frame and of the progress state

## Acceptance Criteria

- [ ] No "Focus", "Generate", "Export", "keyframe", "focus point", "segment", "boundary", "crop box" in Frame or paid-step copy
- [ ] One verb for the paid step across button, progress, completion, errors and cost lines
- [ ] Tests pass
