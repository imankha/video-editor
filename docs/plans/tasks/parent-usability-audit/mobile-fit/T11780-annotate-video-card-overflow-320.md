# T11780: Annotate video/controls card overflows at 320px

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-10-04
**Decision gate:** none (bug fix, no real alternative)

## Epic Context

Epic B: [Fits on phones and tablets](EPIC.md). Found by the T11740 reviewer while verifying
T11740's no-overflow e2e spec: at 320px, `/annotate`'s video/controls card overflows the
viewport, which fails Epic B's AC1 ("no editor page scrolls sideways at 320-428px"). This is
a *different* element than either T11740 (the header) or T11750 (the zero-plays action row)
touches, so neither task owns it and it was previously dropped from tracking (T11740's e2e
spec skipped this exact check at 320 with a comment incorrectly crediting it to T11750 — fixed
in the same commit that adds this task, see T11740's final diff).

## Problem

At 320px, `AnnotateModeView.jsx` around `:733` (the video/controls card) renders roughly 339px
of content inside a box that only has ~278px available, overflowing the page horizontally.
T11740's `e2e/T11740-editor-header-no-overflow.qa.spec.js` could not assert
`assertNoHorizontalOverflow` for Annotate at 320 because of this pre-existing bug (it already
passes cleanly at 360+).

## Solution

Find the exact child(ren) inside the video/controls card that force the ~339px minimum width
at 320px (likely a fixed-width control row, an un-wrapped button group, or a min-width on the
video player's container) and make it responsive down to 320px, consistent with how the rest
of the Annotate screen already handles narrow phones. Re-enable the 320 case in
`e2e/T11740-editor-header-no-overflow.qa.spec.js`'s Annotate loop (remove the `width !== 320`
guard and its comment) once fixed.

## Relevant Files

- `src/frontend/src/modes/AnnotateModeView.jsx` (~:733, the video/controls card)
- `src/frontend/e2e/T11740-editor-header-no-overflow.qa.spec.js` (re-enable the 320 Annotate case)

## Acceptance Criteria

1. `assertNoHorizontalOverflow` passes on `/annotate` at 320, with no regression at 360-1440.
2. T11740's e2e spec's 320 Annotate case is re-enabled and green.

## Tests

- Extend or re-enable the relevant case in `e2e/T11740-editor-header-no-overflow.qa.spec.js`.
- Run locally (Branch CI does not run Playwright).
