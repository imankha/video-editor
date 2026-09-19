# T10550: Rating picker rows carry notation, layer-aware title, mobile-centered dialog

**Status:** STAGING
**Impact:** 3
**Complexity:** 2
**Created:** 2026-09-19
**Updated:** 2026-09-19

## Problem

Follow-up to T10520/T10530. User feedback on the shipped popup (annotated
screenshot): (1) "to solidify what's happening we need to include the short sign in
the rating picker" — each row should show its own chess notation (`!!`/`!`/`!?`/`?`/`??`)
alongside the stars and adjective, tying the row to the eventual collapsed-badge
glyph; (2) "the dialog should say 'Rate your athlete's play'"; (3) follow-up
question — "on mobile this dialog will be centered on the screen, right?" — it was
not: the popup was still an anchored dropdown (`absolute ... top-full left-0`),
which would run off a narrow screen depending on where the badge sits in the row.

## Solution

`PlayProgressBadges.jsx` / `RatingBadge`:
- Each picker row now ends with `RATING_NOTATION[value]` (`aria-hidden`, purely
  decorative reinforcement — the row's real accessible name is still the existing
  `aria-label`), right-aligned via `ml-auto`.
- The popup gained a visible heading, layer-aware like `getRatingCaption`'s existing
  `mine` split: `ANNOTATE.RATE_ATHLETES_PLAY` ("Rate your athlete's play") when
  `myAthlete`, `ANNOTATE.RATE_TEAMS_PLAY` ("Rate your team's play") otherwise — new
  `myAthlete` prop threaded `AnnotateFullscreenOverlay` -> `PlayProgressBadges` ->
  `RatingBadge` (the editor already holds this state for the Layer toggle). The
  radiogroup's `aria-label` now matches the visible heading (so the accessible name
  equals the visible label, not the older generic "Rate this play").
- On mobile (`max-sm:`), the popup becomes a `fixed inset-0` flex-centered dialog
  with a dim backdrop (`bg-black/60`) — tapping the backdrop closes it (its own
  `onClick`, since the backdrop is a DOM ancestor of the box so the existing
  outside-mousedown-on-document listener would otherwise miss it); tapping inside
  the box does not (`stopPropagation`). Desktop (`sm:`) keeps the original anchored
  dropdown. One box now serves both: an outer positioning wrapper (`max-sm:fixed...
  sm:absolute...`) and an inner visual box (`w-full max-w-xs sm:w-auto sm:min-w-[190px]`).

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx` - row glyphs, layer-aware heading, responsive backdrop/centering
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - `myAthlete` passed into `renderProgressBadges`
- `src/frontend/src/config/displayNames.js` - `RATE_ATHLETES_PLAY`/`RATE_TEAMS_PLAY`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.progressBadges.test.jsx` - 4 new tests + 3 existing assertion strings updated

### Related Tasks
- Round 4 of T10410 -> T10440 -> T10450/T10460 -> T10520 -> T10530 -> this task.

## Implementation

### Steps
1. [x] Notation glyph on every picker row
2. [x] Layer-aware visible heading + matching radiogroup `aria-label`
3. [x] Mobile: fixed-centered dialog with dim tap-to-close backdrop; desktop unchanged
4. [x] Tests: row glyphs, layer-aware heading (rerender with a different clip / layer),
       backdrop-click-closes vs. inside-click-does-not
5. [x] Live-drive verified at a real 390px mobile viewport (computed styles + tap-outside)

### Progress Log

**2026-09-19**: Lint clean. `AnnotateFullscreenOverlay.progressBadges.test.jsx`
23/23 green (4 new, 3 updated). Full related sweep (`vitest related` on
`PlayProgressBadges.jsx` + `displayNames.js`, which fans out widely) 231 files / 2052
tests green — no regressions anywhere despite the wide blast radius of touching a
shared copy file. Live-drive at a real 390×844 viewport: opened the mobile "Edit
play" sheet, tapped the rated badge, confirmed via `getComputedStyle` the popup is
`position: fixed; inset: 0; display: flex; justify/align: center; background:
rgba(0,0,0,0.6)`; screenshot confirmed the visible heading and per-row notation;
tapping outside the box (10,10) closed it.

## Acceptance Criteria

- [x] Every picker row shows its own `!!/!/!?/?/??` notation
- [x] Popup heading (and its accessible name) reads "Rate your athlete's play" for
      a My Athlete play, "Rate your team's play" for a Team play
- [x] On a narrow/mobile viewport the popup is a screen-centered dialog with a dim,
      tap-to-close backdrop; desktop keeps the anchored dropdown
- [x] Tests pass; live-verified at a real mobile viewport
