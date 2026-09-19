# T10450: Named badge leads the row; rated badge opens a vertical rating picker

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-18
**Updated:** 2026-09-18

## Problem

Follow-up to T10410/T10440 (play progress badges). User feedback on the shipped row:
(1) the named (pencil) badge should be first since it sits right next to the play name
it completes, not third; (2) clicking the rated (star) badge should not just jump to
and focus the existing horizontal 1-5 star row inside the "Rate and Tag" disclosure —
it should open a dedicated small UI for setting the rating, laid out vertically.

## Solution

`PlayProgressBadges.jsx`:
- Reordered the row: named, rated, noted, clip (was rated, named, noted, clip).
- New `RatingBadge` sub-component replaces the generic `Badge` for the rated slot.
  Clicking it (only while UNDONE, same actionable rule as every other badge) opens a
  popover anchored to the badge: 5 rows, one per rating, 5 ("Brilliant") at top down
  to 1 ("Mental Lapse"), each showing its filled-star count + `RATING_ADJECTIVES`
  label. Picking a row calls the SAME `onRatingChange` every other rating control in
  the editor already uses (`handleRatingChange` in `AnnotateFullscreenOverlay`), then
  closes. Closes on outside click, Escape, or a selection (mousedown/keydown
  listeners scoped to `open`, cleaned up on close — same pattern as `ProfileDropdown`).
  The popover's open/closed flag is the only local state added; the rating value
  itself still lives where it always did (`rating`/`handleRatingChange` in the parent).
- `PlayProgressBadges` now takes `rating`/`onRatingChange` props instead of `onRate`;
  `AnnotateFullscreenOverlay`'s `jumpToRating` (open disclosure + focus the first
  star) is deleted, and the now-dead `id="clip-rating"` + its stale comment were
  removed from `DetailsFields.jsx` (nothing reads that id any more).

The disclosure's own horizontal star row (`DetailsFields.jsx` / `StarRating`) is
UNCHANGED — it's still there for the "Rate and Tag" panel and the global 1-5 keyboard
shortcut is untouched (it already worked regardless of DOM focus). Only the badge's
own click target changed.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx` - reorder + new `RatingBadge`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - wiring (`rating`/`handleRatingChange` instead of `jumpToRating`)
- `src/frontend/src/modes/annotate/components/DetailsFields.jsx` - removed dead `id="clip-rating"`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.progressBadges.test.jsx` - new order + picker tests

### Related Tasks
- Follow-up to T10410 (badges shipped) and T10440 (undone-state color).

## Implementation

### Steps
1. [x] Reorder badges (named first)
2. [x] `RatingBadge` popover component + wiring
3. [x] Remove dead `jumpToRating` / `id="clip-rating"`
4. [x] New tests: render order, picker opens or its own, picker selection sets + closes
5. [x] Lint + targeted tests, commit

### Progress Log

**2026-09-18**: Lint clean (0 errors; pre-existing unrelated warnings in
`AnnotateFullscreenOverlay.jsx` untouched by this change). New/targeted tests:
`AnnotateFullscreenOverlay.progressBadges.test.jsx` 16/16 green (3 new). Broader
related run (`vitest related` across the 3 changed source files) 210/210 green across
32 files. Live-browser visual check skipped — Playwright was already in use by
another concurrent session on this shared machine for the whole session (same
constraint as T10430/T10440); styling follows the codebase's own established
anchored-dropdown pattern verbatim (`ProfileDropdown.jsx`: `relative` wrapper +
`absolute ... top-full mt-2 ... bg-gray-800 border-gray-700 rounded-lg shadow-xl z-50`
+ a `mousedown` outside-click listener), so risk is low, but not visually confirmed.

## Acceptance Criteria

- [x] Badge row order is named, rated, noted, clip
- [x] Clicking the rated badge (while undone) opens a vertical 5-row rating picker,
      not the Rate and Tag disclosure
- [x] Picking a row sets the rating via the editor's existing setter and closes the
      picker; the clip badge still wakes to its 5-star nudge as before
- [x] Tests pass
