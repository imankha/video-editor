# T10530: Done rated badge shows the rating's own chess notation, not a generic star

**Status:** STAGING
**Impact:** 2
**Complexity:** 1
**Created:** 2026-09-19
**Updated:** 2026-09-19

## Problem

Follow-up to T10520 (rating badge popup). Once DONE, the rated badge's disc always
showed a generic `Star` icon, giving no hint of WHICH rating was actually given
without opening the popup. User request: show the rating's own chess-style notation
(`!!`/`!`/`!?`/`?`/`??`, from `clipConstants.RATING_NOTATION` — the same notation
already used everywhere else a rating is displayed: `ClipListItem`, the Annotate
timeline marker, the notes overlay, the Focus clip sidebar) inside the green disc
instead.

## Solution

`PlayProgressBadges.jsx`:
- `Disc` gained an optional `glyph` prop: when provided, it renders that string
  (bold, sized to the disc) instead of the `Icon` component. Two-character glyphs
  (`!!`, `!?`, `??`) render a touch smaller (`iconSize * 0.75`) so both characters
  clear the circle.
- `RatingBadge`'s closed button passes `glyph={state === DONE ? RATING_NOTATION[rating] : undefined}`
  — UNDONE still shows the plain `Star` icon (there's no "given" rating yet to
  notate); DONE shows the notation. The green disc, checkmark corner badge, and
  always-clickable behavior from T10520 are all unchanged — only the glyph inside
  swaps.

Deliberately did NOT reuse `RatingIcon.jsx` (the drawn per-rating-colored disc used
elsewhere) — nesting its own solid colored circle inside the badge's own
green-bordered disc would double up the circular chrome. Plain notation text keeps
the existing "done = green circle + checkmark" badge language intact and just adds
information inside it.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx` - `Disc` glyph prop, `RatingBadge` wiring
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.progressBadges.test.jsx` - new test

### Related Tasks
- Follow-up to T10520 (rating badge popup + `rated` semantics rewrite).

## Implementation

### Steps
1. [x] `Disc` accepts an optional `glyph` override
2. [x] `RatingBadge` passes the rating's `RATING_NOTATION` glyph when DONE
3. [x] New test asserting the glyph changes with the rating (??/!?/!!)
4. [x] Live-drive verified (ARIA tree + screenshot)

### Progress Log

**2026-09-19**: Lint clean. `AnnotateFullscreenOverlay.progressBadges.test.jsx`
20/20 green (1 new); broader related run (`vitest related` on `PlayProgressBadges.jsx`)
32 files / 216 tests green. Live-drive: reopened the previously-rated "adf" play in
the real browser; the accessibility tree confirmed `button "Play rated"` contains
`"!!"` for its 5-star rating, matching the earlier screenshot showing the same glyph
rendered inside the green disc.

## Acceptance Criteria

- [x] A DONE rated badge shows the rating's own `RATING_NOTATION` glyph, not a star
- [x] An UNDONE rated badge still shows the plain star (nothing to notate yet)
- [x] Tests pass
