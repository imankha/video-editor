# T11840: Legible rating and a way to make any play a highlight

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Tier:** M (frontend only, ~6 files + tests, ~200 LOC). No backend or schema change.
**Created:** 2026-10-04
**Decision gate:** H1 (recommended: hybrid, option 3) and H2 (recommended: X close on the rate modal)

## Epic Context

Task 1 of 3 in [Epic D](EPIC.md). **Read the EPIC first**: this task reverses Highlight-First
ruling H3 (2026-09-24) if the user picks option 2 or 3. Runs after T11750 and T11800. Milestone
rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [desktop/04](../../../ux/2026-10-04-parent-usability-audit/desktop/04-marked-play-rating-required.png).
After Mark play, the editor shows five unlabeled stars and a gray "Rate this play" chip that looks
disabled. Nothing says that 5 stars is what unlocks "Make Highlight Now". The tester found the rule
only in the mode bar's help text. On touch, the rate modal has no visible way out except picking a rating.

## Solution (H1 option 3 "hybrid" + H2 X close)

1. **One rating control.** Delete the bare `StarRating` row ("Rating" + 5 stars). Replace the pill
   with an inline labeled row inside the editor's Name/Rating group:
   - Label `text-sm text-gray-300`: **How good was this play?**
   - Five 44px star buttons, 1 to 5 left to right. Under each, always visible, `text-xs text-gray-400`:
     **Mental Lapse**, **Technical Lapse**, **Interesting**, **Good**, **Brilliant** (from
     `RATING_ADJECTIVES`; do not create a new map). Selected star + caption turn `text-amber-400`;
     the Brilliant cell gets the gold ring.
   - 390px: each cell ~66px wide, captions `text-[11px]`, may wrap to 2 lines. No horizontal scroll.
2. **Caption under the row** (`text-sm text-gray-300`): **5 stars (Brilliant) offers to make it a highlight.**
3. **"Make a highlight anyway"** when the rating is 1-4 or unset: text button
   `text-sm text-cyan-300 hover:text-cyan-200 underline-offset-2`, `Sparkles` 14. It opens the
   existing gold `HighlightChoiceCard` (Make Highlight Now / Keep Annotating). No new surface.
4. **Keep H5:** the rate-on-exit modal stays.
5. **H2 X close:** icon-only X in the rate modal header, `p-2 text-gray-400 hover:text-white`, size 20,
   aria-label **Back to the play**. Same behavior as Escape: return to the editor, write nothing.
   Backdrop stays inert (never close on backdrop click).
6. **Mode bar help** (`ModeSwitcher.jsx:97-100`): **Rate a play 5 stars (Brilliant), or tap Make a
   highlight anyway.** / locked Frame Highlight: **Select a play to frame it.**
7. Fix the wrong comment at `AnnotateModeView.jsx:310-313` (the stage CTA is ungated on purpose now).

## Relevant Files (under `src/frontend/src/`)

- `containers/AnnotateContainer.jsx:88, 632-702 (guardRateThenExit), 713-721 (maybeOpenHighlightChoice), 1992-2034, 2083-2100`
- `modes/annotate/components/HighlightChoiceCard.jsx:22-58`
- `modes/annotate/components/AnnotateFullscreenOverlay.jsx:382-384, 466, 472-475` (+ the repeats at `:642/651`, `:772/776`, `:902/908`)
- `modes/annotate/components/RatingPill.jsx:186-228`, `RateThisPlayModal` (rate gate modal)
- `components/shared/clipConstants.js:10-30, 76, 127-141`
- `components/shared/ModeSwitcher.jsx:97-100`
- `config/displayNames.js:41-54, 82`

## Implementation Steps

1. Strings: add `ANNOTATE.RATING_QUESTION`, `ANNOTATE.RATING_HIGHLIGHT_HINT`,
   `ANNOTATE.MAKE_HIGHLIGHT_ANYWAY`, `ANNOTATE.RATE_MODAL_CLOSE_LABEL`; update the ModeSwitcher help.
2. Build the labeled row (reuse `StarRating` internals if it can render captions; otherwise extend it
   with a `showCaptions` prop). Remove the duplicate control at all four render sites.
3. Add `onMakeHighlightAnyway` in `AnnotateContainer`: it opens the same `HighlightChoiceCard` state
   that `maybeOpenHighlightChoice` opens. Reuse `highlightChoiceInFlightRef` so a double tap never
   creates two projects.
4. Add the X to the rate modal, wired to the existing Escape handler.
5. Update the stale comment.

## Acceptance Criteria

1. After Mark play, the editor shows one star row with a word under every star and the caption.
2. Picking 5 stars offers the highlight choice exactly as today.
3. With 1-4 stars or none, "Make a highlight anyway" opens the same choice; "Make Highlight Now"
   creates the highlight and opens Frame Highlight, awaiting the region write queue first.
4. On a touch device the rate modal can be left with the X, and nothing is written.
5. Ratings still save through the existing gesture path; no new write path.

## Tests (red first)

- `AnnotateContainer.rateGate.test.jsx`, `AnnotateScreen.rateGate.test.jsx`,
  `AnnotateFullscreenOverlay.highlightChoice.test.jsx` (add: anyway link opens the card at rating 3),
  `AnnotateFullscreenOverlay.rateGateEscape.test.jsx` (add: X behaves like Escape),
  `RateThisPlayModal.test.jsx`, `RatingPill.test.jsx`,
  `AnnotateFullscreenOverlay.progressBadges.test.jsx:53-73` (pins pill -> rating-input -> details
  order; update to the single control), `ModeSwitcher.test.jsx`,
  `AnnotateModeView.highlightInstances.test.jsx`.
- E2E (local): `e2e/T10760-selector-scoped-reads.qa.spec.js`.

## Landmines

- Keep `highlightChoiceInFlightRef` / `frameCreateInFlightRef` (double-create guards).
- Navigation must await the region write queue.
- `maybeOpenHighlightChoice` takes `pickedRating` explicitly because of a stale-ref ordering trap; keep that.
- Do not reintroduce a local `RATING_*` map (annotate.md landmine).

## If the user picks a different H1 option

- **Option 1 (keep H3, make it legible):** do steps 1-2 and 4-5; skip "Make a highlight anyway";
  caption is **Rate it 5 stars (Brilliant) to make it a highlight.** (and **Brilliant. Press Done to
  make it a highlight.** once rated 5). Also gate the main-screen stage CTA
  (`AnnotateModeView.jsx:1285-1304`) to 5-star plays so H3 is actually true.
- **Option 2 (decouple):** footer becomes `[Delete play] ... [Make this a highlight] [Done]`
  (primary `bg-cyan-600`; at 390 a full-width `min-h-[52px]` button above a Delete/Done row); rating
  optional; remove the rate-on-exit modal (H5) and `guardRateThenExit`; retire the choice card.
  Record reversals in the T11120 and T11130 task files.
