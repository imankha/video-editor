# T11410: Keep the Annotate rating picker visible in fullscreen

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-28
**Updated:** 2026-10-03
**Reported environment:** Production build 5870, desktop fullscreen Annotate

## Problem

Clicking **Rate this play** while Annotate is fullscreen can render the rating picker beyond the
right and bottom viewport edges. The production screenshot shows only a narrow clipped portion of
the card, making the rating choices unusable.

## Investigation

This is the normal `RatingPill` picker, not the required-rating gate. On non-mobile viewports it is
an `absolute top-full left-0` child of the pill's `relative` wrapper. In the fullscreen editor the
pill sits near the bottom/right edge, so the dropdown expands outside the viewport. The mobile
branch is viewport-fixed, but desktop fullscreen has no portal, collision detection, flip, or
max-height/overflow handling.

## Solution Direction

Make the desktop picker viewport-aware. Prefer an existing project popover/portal positioning
pattern if one exists; otherwise portal it and calculate a clamped/flip-above position from the
pill anchor. Preserve outside-click and Escape behavior, focus semantics, and the shared
`RatingMeaningsList`.

## Context

### Relevant Files

- `src/frontend/src/modes/annotate/components/RatingPill.jsx` — anchored dropdown implementation.
- `src/frontend/src/modes/annotate/components/RatingMeaningsList.jsx` — picker contents.
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — fullscreen host.
- `src/frontend/src/modes/AnnotateModeView.jsx` — fullscreen container geometry.
- `src/frontend/src/modes/annotate/components/RatingPill.test.jsx` (or nearest rating-pill tests)
  — add viewport/collision coverage.

## Implementation

### Steps

1. [x] Reproduce at the screenshot-sized fullscreen viewport and record anchor/card rectangles.
2. [x] Add a failing viewport-boundary test for right/bottom-edge anchors.
3. [x] Implement portal/collision positioning with resize/scroll updates as needed.
4. [x] Verify windowed desktop, fullscreen desktop, and mobile bottom-sheet behavior (jsdom only -- real-browser pass still owed, see Progress Log).

### Progress Log

**2026-10-03**: Round 1 review found 1 BLOCKING (Escape's bubble-phase `stopPropagation` didn't
stop `AnnotateContainer`'s sibling document-level Escape listener, so Escape also exited
fullscreen) + 2 MAJOR (a one-way height-measurement ratchet reading the already-capped rect
instead of `scrollHeight`, and broken keyboard tab order from the `document.body` portal). All
fixed: capture-phase Escape handler with `stopImmediatePropagation`, `scrollHeight`-based
natural-height measurement, explicit focus management (into the card on open, back to the
trigger on Escape). Round 2 (fresh context): APPROVED, 0 blocking/0 major. Proof Verifier:
VERIFIED, independently reproduced red-to-green for all three fixes, full suite 40/40, CI
green. Merged PR #557 (`5fb38ed24`). Real-browser staging pass still owed (jsdom can't prove
pixel layout) -- verify fullscreen Annotate near a viewport edge: all 5 rows visible/clickable,
picker flips without covering the trigger, Escape closes only the picker.

## Acceptance Criteria

- [x] Every rating row is visible and clickable when opened near any viewport edge.
- [x] The picker flips/clamps without covering the trigger unnecessarily.
- [x] Escape and outside-click close only the picker, not the fullscreen editor.
- [x] Mobile retains its full-width bottom sheet.
