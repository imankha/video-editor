# T5674: Overlap & overflow fixes (report pill, panel scrollbar, crop label)

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-07-20
**Epic:** [UI Pass](EPIC.md) — task 4 of 7

## Problem

Three collision/overflow defects found in the 2026-07-20 audit (findings #4, #5, #6). Each is
small; bundled because they're the same class (elements fighting for space) and each is a
"looks broken" signal:

1. **"Report a problem" pill collides with content.** On editor screens the floating pill sits
   vertically mid-viewport at the right edge; in **Annotate at 1315×748 it overlaps the
   player's volume slider** (screenshot evidence in audit). On Framing/Overlay it overlaps the
   content column edge. On Home it sits bottom-right (correct).
2. **Annotate left panel has a stray horizontal scrollbar** along its bottom — panel content
   overflows its fixed width, showing a permanent gray scrollbar track under the clip details
   controls.
3. **Framing crop dimension label clips at the video's top edge.** The `513x911 @ (2, 25)`
   badge attached to the crop reticle renders half-outside the video container when the crop
   touches the top (cut off mid-glyph).

## Solution

1. Pin the report pill to a consistent safe corner (bottom-right, matching Home) on ALL
   screens, `z`-layered above content but never overlapping interactive controls — if the
   player control bar occupies bottom-right on small heights, offset above it or collapse the
   pill to an icon on editor screens. Verify at 390×844, 768×1024, 1315×748, 1920×1080.
2. Find the overflowing child in the Annotate left panel (likely a fixed-width row — the
   filmstrip/track strip in clip details) and constrain it (`min-w-0`/`overflow-hidden` on the
   right element, not a blanket `overflow-x-hidden` that hides real content).
3. Flip the crop label below the reticle edge when within label-height of the container top
   (standard tooltip edge-flip), or clamp inside the video rect.

## Context

### Relevant Files (REQUIRED)
- Report pill component — grep `"Report a problem"` in `src/frontend/src` (shared across screens)
- Annotate left panel — `src/frontend/src/modes/annotate/` clip details panel (find overflowing row via devtools)
- Crop label — `CropOverlay` / crop reticle component in Framing (`src/frontend/src/modes/framing/` or `components/`), the size/position badge
- `e2e` usability audit manifests (T4930) — add a no-overlap assertion for the pill vs. player controls if cheap

### Related Tasks
- Epic siblings T5675/T5676 touch adjacent screens — keep diffs disjoint
- T4930 usability matrix — extend, don't fork

### Technical Notes
- Presentational only; zero logic/persistence changes.
- CropOverlay carries drag-race history (T5380) — do not touch pointer handlers, only the
  label's positioning math/classes.
- Real-browser verification required at all four viewports (drag the crop to the top edge for
  defect 3; jsdom proves nothing here).

## Implementation

### Steps
1. [ ] Report pill: single positioning strategy, all screens, four viewports screenshot-verified
2. [ ] Annotate panel: locate + fix overflow at the offending child
3. [ ] Crop label: edge-flip/clamp; verify by dragging crop to top edge in real browser
4. [ ] Screenshot evidence per fix per viewport

## Acceptance Criteria

- [ ] Report pill never overlaps interactive controls on Home/Annotate/Framing/Overlay at 390/768/1315/1920 widths
- [ ] No horizontal scrollbar in the Annotate left panel; no content hidden by the fix
- [ ] Crop label fully legible with the crop at every container edge (incl. top)
- [ ] Real-browser screenshots at all viewports; lint hooks green
