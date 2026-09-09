# T9350: Move the Add footage button

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-09
**Updated:** 2026-09-09 (placement DECIDED: option A)

## Problem

User request 2026-09-09 (screenshot with an arrow from the empty space top-left of the player to the
circled button): move "Add footage".

Today it renders right-aligned in a header row directly above the Annotate timeline
(`modes/AnnotateModeView.jsx:840-849`). T8910 put it there deliberately - "Add footage lives WITH
the timeline (it acts on the timeline), not in UnifiedHeader" - so this is a reversal of a
considered decision, not a bug fix. It sits below the fold on a phone and competes with the Edit Play
CTA.

## Decision (user, 2026-09-09)

**Option A: a new toolbar row top-LEFT, above the video canvas, paired with the existing Zoom
control on the right.** Chosen from three mocked options (decision artifact, 2026-09-09); B (game
header row) and C (top-right beside Zoom) were rejected. A fills the dead space the user's arrow
pointed at and puts the button above the fold on every viewport.

```
+------------------------------------------------+
| [+ Add footage]              [Zoom - 100% +]   |   <- new toolbar row
+------------------------------------------------+
|                  VIDEO CANVAS                  |
+------------------------------------------------+
|  ------------ timeline tracks ------------     |   <- button no longer lives here
+------------------------------------------------+
```

The Zoom control currently floats over the top-right of the canvas. Decide during implementation
whether it moves into the new row with Add footage (one honest toolbar) or stays floating with Add
footage floating opposite it; the mock shows the former, which is the cleaner result but touches
more of the canvas overlay layout.

## Solution

Move the `AddFootageButton` render site out of the timeline header row into the chosen container.
Component internals (picker, credits cost line, upload progress, `onFootageAttached` callback) are
untouched.

Invariants:

- The **window-level drag-and-drop target stays exactly as it is** - `AddFootageButton` owns both
  the click path and the drop path, and dropping a file anywhere on Annotate must still open the
  same picker in `attachMode`.
- The button already hides with the timeline when the under-canvas editor is open
  (`!annotateFullscreen && !underCanvasEditor`). Whatever container it moves to must reproduce the
  right visibility rule - option A or C sit above the video, which stays mounted while the editor is
  open, so decide deliberately whether Add footage remains visible mid-edit (proposal: hide it, to
  match today).
- Touch targets floor at 44px on coarse pointers (capability query, never UA sniff - T7350).
- Do not regress the fullscreen-annotate layout, which has its own overlay controls in the same
  corners.

## Files

- `src/frontend/src/modes/AnnotateModeView.jsx` - the render site
- `src/frontend/src/modes/annotate/AddFootageButton.jsx` - only if the new container needs a size or
  variant prop

## Tests

Relevant set (~6), curated:

- `modes/AnnotateModeView.cta.test.jsx` - CTA layout guard
- `modes/AnnotateModeView.beaconSurfaces.test.jsx`
- any existing Add-footage test (T8910's) asserting the button renders and opens the picker
- the drag-and-drop path test, if one exists
- the Annotate e2e spec covering attach-footage

## Notes

- Tier S once the placement is chosen. Frontend only, no backend or schema change.
- Reverses part of T8910's placement rationale - note that in the commit message so the next reader
  does not treat it as an accident.
