# T10430: Brilliant (5-star) rating icon should pop

**Status:** STAGING
**Impact:** 3
**Complexity:** 1
**Created:** 2026-09-18
**Updated:** 2026-09-18

## Problem

User request 2026-09-18 (with a reference image: a chess-style "!!" on a solid teal disc):
"I want the brilliant icon to pop more." The 5-star "Brilliant" badge was `!!` text on a
light-green (`#66BB6A`) rounded rectangle, the same shape and near the same hue as the 4-star
"Good" badge (`#2E7D32`). At badge size (10-14px text) the two were hard to tell apart, so the
one rating that actually creates a clip did not stand out anywhere it appears.

## Solution

- New `components/shared/BrilliantIcon.jsx`: an SVG disc in the Brilliant palette color with
  a bold white double-exclamation drawn as tapered bars + rounded dots, a darker bottom rim and
  glyph drop shadow (own design, inspired by the reference). Decorative SVG (`aria-hidden`)
  plus a visually hidden `!!` so textContent-based assertions and screen readers keep the
  notation; wrappers keep their `title`/`aria-label` from `getRatingLabel`.
- `clipConstants.js`: `BRILLIANT_RATING = 5`; rating 5 moved from light green to teal
  (`#17B3A3`, tint updated to match), so every surface deriving from `RATING_BADGE_COLORS`
  (share-modal chips, selection tints, notes-overlay border) agrees.
- The four notation-badge sites render the icon for rating 5 and are unchanged for 1-4:
  Annotate play list (`ClipListItem`), Annotate timeline desktop marker (`ClipRegionLayer`;
  marker box goes transparent, layer underline / angle accent / selection ring kept),
  notes overlay (`NotesOverlay`), Focus clip sidebar (`ClipSelectorSidebar`).
- Mechanical prerequisite commit: `NotesOverlay` and `ClipRegionLayer` carried byte-identical
  copies of the rating palette; both now import `RATING_BADGE_COLORS`.

## Context

### Relevant Files
- `src/frontend/src/components/shared/BrilliantIcon.jsx` (new) + `BrilliantIcon.test.jsx` (new)
- `src/frontend/src/components/shared/clipConstants.js`
- `src/frontend/src/modes/annotate/components/ClipListItem.jsx`
- `src/frontend/src/modes/annotate/components/NotesOverlay.jsx`
- `src/frontend/src/modes/annotate/layers/ClipRegionLayer.jsx`
- `src/frontend/src/components/ClipSelectorSidebar.jsx`

### Verification
- Lint clean on all changed files (pre-existing warnings only).
- Curated set, 10 files / 91 tests green: new `BrilliantIcon.test.jsx`, `clipConstants.test.js`,
  `ClipSelectorSidebar.test.jsx`, three `ClipListItem.*.test.jsx`, two `ClipRegionLayer.*.test.jsx`,
  `AnnotateTimeline.twoLane.test.jsx` (asserts `!!` in lane textContent, still satisfied via the
  hidden notation), `RecapPlayerModal.test.jsx`.
- Visual check: rendered the icon at 18/20/24/30/96/160px next to the old badges, the timeline
  marker treatment (layer underline + selected ring) and the notes overlay pill (Playwright
  screenshot, not committed).
