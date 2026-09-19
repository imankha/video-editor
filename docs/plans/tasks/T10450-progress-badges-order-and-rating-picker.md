# T10450: Named badge leads the row; rated badge expands in place into a star column

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

**Round 1 (same day) shipped a floating dropdown popover** (a bordered/shadowed panel
below the badge, with adjective text labels) — user rejected it after seeing it live:
"I wanted the star indicator to become the component that sets it when clicked, [a
separate popover] is not what I wanted." Asked to confirm the exact design before a
third guess (`AskUserQuestion`, 3 concrete previews); user picked **expand in place,
vertically**: no popup box, the badge disc itself is replaced by a bare vertical stack
of 5 plain stars, siblings shift right in the normal flex flow.

## Solution

`PlayProgressBadges.jsx`:
- Reordered the row: named, rated, noted, clip (was rated, named, noted, clip).
- New `RatingBadge` sub-component replaces the generic `Badge` for the rated slot.
  Clicking it (only while UNDONE, same actionable rule as every other badge) does NOT
  open a floating panel — it swaps the `Disc` button for a bare `flex flex-col` stack
  of 5 `Star` buttons (the SAME icon/fill logic `StarRating.jsx` already uses, just
  vertical instead of horizontal; no box, border, shadow, or text labels), 5 on top
  down to 1. This is inline in the badge row (not `position: absolute`), so sibling
  badges naturally shift right while it's expanded — no z-index/overflow concerns.
  Picking a star calls the SAME `onRatingChange` every other rating control in the
  editor already uses (`handleRatingChange` in `AnnotateFullscreenOverlay`), then
  collapses back to the disc. Also collapses on outside click or Escape (mousedown/
  keydown listeners scoped to `open`, cleaned up on close — same pattern as
  `ProfileDropdown`'s dropdown, adapted from Round 1). The open/closed flag is the
  only local state; the rating value itself still lives where it always did
  (`rating`/`handleRatingChange` in the parent).
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

**2026-09-18 (round 1)**: Shipped the dropdown-popover version (commit 2e584c7e).
Lint clean, `AnnotateFullscreenOverlay.progressBadges.test.jsx` 16/16 green (3 new),
broader related run 210/210 green across 32 files. Live-browser check skipped
(Playwright in use by a concurrent session).

**2026-09-18 (round 2)**: User screenshot showed the live popover and rejected it —
wanted expand-in-place, not a floating panel. Asked one clarifying question with 3
concrete previews rather than guess again; user picked "expand in place, vertically."
Rewrote `RatingBadge` accordingly (see Solution); rewrote the 2 affected tests to
query `role="radiogroup"`/`role="radio"` instead of `menu`/`menuitemradio`, and
scoped the `radio` query with RTL's `within()` (the Layer segmented control also uses
`role="radio"`, so the unscoped query was catching "My athlete"/"Team" too — caught by
the test itself, fixed). Lint clean, same test file 16/16 green, broader related run
210/210 green. Live-browser check attempted again (browser became free this round)
but blocked by an unrelated environment issue: the dev Postgres backing this account's
games came back empty (`GET /api/games` -> `{"games": []}`) mid-session, almost
certainly another concurrent session's backend test run truncating the shared dev DB
([reference_dev_gotcha] pattern) — not something this task caused or can fix from
here. Falling back to: full test coverage of the interaction (order, expand-in-place
using the SAME `data-testid`, ARIA roles, selection collapses + sets rating, clip
nudge still wakes) plus the fact that the CSS is a direct copy of `StarRating.jsx`'s
already-proven-live star row (`flex` -> `flex-col`, same `Star` fill/color logic,
same `hover:scale-110` button), so real-layout risk is low even though not visually
confirmed this round either.

## Acceptance Criteria

- [x] Badge row order is named, rated, noted, clip
- [x] Clicking the rated badge (while undone) expands it IN PLACE into a bare
      vertical 5-star column (no popup box/border/shadow/labels), not a separate
      floating panel and not the Rate and Tag disclosure
- [x] Picking a star sets the rating via the editor's existing setter and collapses
      back to the disc; the clip badge still wakes to its 5-star nudge as before
- [x] Tests pass
