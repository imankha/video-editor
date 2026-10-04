# Epic D: Make a highlight without guessing

**Status:** TODO (gated on decisions H1-H4)
**Milestone:** [Parent Usability Audit](../README.md)
**Impact:** 8 | **Complexity:** 5
**Knowledge docs:** `.claude/knowledge/annotate.md`, `.claude/knowledge/persistence-sync.md`

## Goal

After marking a play, a parent can see how to make it a highlight without discovering an
unexplained 5-star rule, and the Annotate screen's first view shows one obvious action.

## This epic reverses recent owner rulings: decide before implementing

The Highlight-First epic (`docs/plans/tasks/highlight-first/EPIC.md`, prod 2026-09-28) made the
rating **the** gesture:
- **H3 (2026-09-24):** "rating 5 is the only way to make a highlight."
- **H5:** every exit from the play editor opens the rate modal (T11120).
- **T11390 (2026-09-28):** removed the modal's visible "Keep editing" button, so Escape is the only
  non-rating exit. Phones have no Escape key.
- **Round 2 ruling 6 (2026-09-24):** mode bar "Annotate / Frame Highlight / Add Spotlight".
- **T10780 (2026-09-20) / T10930:** phone timeline opens at 300%.

The audit is the newer outside evidence. Per the standing rule, the conflict goes to the user with
dates; whatever they pick is recorded as a dated reversal (or upheld) in the superseded task files.

## Verified findings (2026-10-04)

- **The gate is frontend-only.** `containers/AnnotateContainer.jsx:88` `HIGHLIGHT_RATING = 5`;
  `maybeOpenHighlightChoice` (`:713-721`) opens `HighlightChoiceCard` ("Make Highlight Now" /
  "Keep Annotating") only at 5. The backend never infers a highlight from rating
  (`backend/app/routers/clips.py:1436-1441, 1628-1635`). Removing or relaxing the gate needs no
  backend or schema change.
- **H3 is already not true in the product.** `modes/AnnotateModeView.jsx:1285-1304` shows a
  "Make Highlight" stage CTA (`clipStage.js:91-99`, `handleFrameNow` `:261-283`) for any selected
  play with no highlight, whatever its rating. The comment at `:310-313` saying otherwise is wrong.
- **Two rating controls at once:** `RatingPill` "Rate this play" in slate `#64748b` (looks disabled)
  plus a bare unlabeled 5-star row headed "Rating" (`AnnotateFullscreenOverlay.jsx:466, 472-475`;
  repeated at `:642/651`, `:772/776`, `:902/908`). Pinned by `AnnotateFullscreenOverlay.progressBadges.test.jsx:53-73`.
- **Rating word drift:** round 2 ruling 2 (2026-09-24) renamed 5 stars to "Highlight"; code says
  "Brilliant" (`components/shared/clipConstants.js:10`). This epic uses the shipped word, "Brilliant".
- **What reads the 5-star value:** recap auto-export selection (5, then 4 fallback,
  `services/auto_export.py:295-305`), game-card `brilliant_count`, poster pick (`poster.py:1084-1096`),
  T3630 ranking seed (null-safe). None needs 5 stars to *create* a highlight. Forcing 5 stars to get
  a highlight inflates exactly this data.
- **Annotate density:** no progressive disclosure exists. Phones open the timeline at 300%
  (`modes/AnnotateModeView.jsx:345`), and `resetZoom` goes to 100%, not the default.

## Design decisions

Full proposal: [annotate-rating-upload-signin.md](../../../ux/2026-10-04-parent-usability-audit/design/annotate-rating-upload-signin.md).

## Tasks (order: shared `AnnotateModeView.jsx` / `AnnotateFullscreenOverlay.jsx`)

| ID | Task | Status |
|----|------|--------|
| T11840 | [Legible rating and a way to make any play a highlight](T11840-rating-legibility-and-highlight-anyway.md) | TODO |
| T11850 | [Rename "Annotate" to "Mark Plays" in the UI](T11850-rename-annotate-to-mark-plays.md) | TODO |
| T11860 | [First-run Annotate shows one obvious action](T11860-annotate-first-run-disclosure.md) | TODO |

T11840 runs after T11750 and T11800. T11850 runs after T11740 (same `ModeSwitcher` / header).
T11860 runs last in the chain.

## Downstream

The Tutorial Redesign guided tour (T7630/T7640, owner-ruled to ship LAST) anchors on these
controls. Add a note to those task files: anchor on "Mark play" and the labels this epic ships, not
on controls hidden by T11860.

## Completion criteria

- [ ] A parent can see, inside the play editor, how this play becomes a highlight.
- [ ] One rating control, with words under the stars.
- [ ] The rate modal has a visible, touch-friendly exit.
- [ ] `annotate.md` updated (gate rule as decided, disclosure, zoom default).
