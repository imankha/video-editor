# Highlight-First Annotate Flow

**Status:** TODO (WAITING ON USER: decision artifact + badge/flow mockups)
**Started:** 2026-09-24
**Impact:** 9 **Complexity:** 6 **Priority:** 1.5
**Sibling epic:** [Single-Clip Editor, Reels removed](../single-clip-editor/EPIC.md) (ships in the same version)
**Decision artifact:** https://claude.ai/artifact/CWHnjGEUCzqMhgeyQGrzwB (answers in its `answers` db collection)
**Mockups:** https://claude.ai/artifact/FFGqtZQnE4a9n9PHjANaeA

## Goal

User's words (2026-09-24): "The point is to get users intuitively making highlights."

Today a parent marks a play, optionally rates it, and then has to discover a separate
"Create clip" / "Frame" / "Frame Now" / "Frame Later" control to turn it into something. The
new flow makes the RATING the gesture:

1. Editing a play **requires** a star rating.
2. The 5-star adjective **"Brilliant" becomes "Highlight"**.
3. Pressing **Done** on a Highlight-rated play opens a popup:
   - **Make Highlight Now** = old Frame Now (create the clip, open Framing).
   - **Keep Annotating** = old Frame Later (create the clip, it lands in Clips, stay in Annotate).
     The user must learn they can turn it into a highlight later from Clips.
4. "Create clip" and "Frame" CTAs leave Annotate.
5. Mode bar: **Annotate / Frame Highlight / Add Spotlight**. The last two are clickable only
   once a clip exists for that highlight.
6. The play-progress badges are redesigned around this (UX mockups: T11100).

## Vocabulary conflict (must be ruled, see H1)

This **reverses the 2026-09-13 ruling** in PLAN.md ("Clip and Reel both stand. 'Highlight' is a
MODIFIER, not a third object") and renames the mode noun "Framing" chosen the same day. The
user's 2026-09-24 request is the later decision; the decision artifact asks for the explicit
confirmation and the resulting noun chain.

## Tasks

Frontend-heavy; backend touches only rating-label constants (T11110). No schema change.
**Order:** T11100 (design gate) first. T11110 is independent and can land any time. T11120 ->
T11130 are strict (same files: `AnnotateFullscreenOverlay.jsx`, `AnnotateModeView.jsx`,
`AnnotateContainer.jsx`). T11140 is file-disjoint from T11120/T11130 except `AnnotateScreen.jsx`.

| ID | Task | Tier | Status |
|----|------|------|--------|
| T11100 | [UX design gate: badges, Done popup, rating gate, mode bar](T11100-ux-design-gate.md) | design | WAITING ON USER |
| T11110 | [Rename 5-star "Brilliant" to "Highlight"](T11110-brilliant-to-highlight-rename.md) | M | TODO |
| T11120 | [Require a star rating to leave the play editor](T11120-require-rating-gate.md) | M | TODO |
| T11130 | [Done popup: Make Highlight Now / Keep Annotating; remove Create clip + Frame CTAs; new badges](T11130-done-popup-highlight-choice.md) | L | TODO |
| T11140 | [Mode bar: Frame Highlight / Add Spotlight, gated on the selected play's clip](T11140-mode-bar-rename-and-gating.md) | M | TODO |

## Open questions (answered in the decision artifact)

Recommended default in brackets. IDs are referenced from the task files.

| # | Question |
|---|---|
| H1 | Confirm the vocabulary reversal: user-facing noun chain becomes play -> **highlight** -> published highlight; "Reel" is reserved for the future post-publish stitcher (T11300). [yes] |
| H2 | "Framing" -> "Frame Highlight" and "Spotlight" -> "Add Spotlight": tab labels only, or all ~30 derived strings ("Generate Framing", "Framing ready", ...)? [tab labels + screen headings only; process nouns follow in the copy sweep] |
| H3 | Done on a 1-4 star play: just close (no clip), or also offer a clip? With the CTAs gone, rating 5 becomes the ONLY way to make a highlight. [just close; re-rate to Highlight to promote] |
| H4 | Popup dismissal (Escape / X): back to the editor with no write, or treated as Keep Annotating? Backdrop click never closes (standing rule). [Escape returns to the editor, no write; no X] |
| H5 | Which exits the rating gate blocks: in-editor only (Done, X, Escape) or also timeline click, switching plays, mobile fullscreen exit, mode bar / Home? Delete play always allowed. [all exits] |
| H6 | Legacy NULL-rated plays: gated when their editor next opens, no backfill. [yes] |
| H7 | Re-rating an existing clip-less play to Highlight: popup on Done. Play already has a clip: no popup. Downgrading a play that has a clip: clip stays. [yes, yes, stays] |
| H8 | Also remove the post-creation stage CTA ("Frame" / "Apply Spotlight" / "View Final" + "Keep marking plays") inside the editor and the main-screen `annotate-stage-cta`? [remove from editor; keep ONE main-screen stage button, reworded to the new nouns, because the mobile mode bar is icon-only] |
| H9 | Mode-bar gating follows the SELECTED play's clip; no play selected = locked. Add Spotlight stays locked until Framing is exported. [yes] |
| H10 | Backend derived names ("Brilliant Goal" -> "Highlight Goal"): rename going forward; backfill legacy persisted `projects.name` values? [rename forward, no backfill] |
| H11 | Quest step `annotate_brilliant`: keep the persisted id, update its copy. [yes] |
| H12 | Badge / popup / gate / mode-bar picks from the mockups (A1-A3, B1-B2, C1-C2, D). [A1, B2, C1, D per ui-designer] |
| H13 | Team plays: a 5-star TEAM play does not create a clip today (`clipConstants.js:109`). Does a Team play rated Highlight get the Done popup? [open, no default] |
| H14 | Add Spotlight unlock: as soon as the clip exists (literal reading of the request) or only after Framing has been exported (today's rule, `ModeSwitcher.jsx:69`; Spotlight edits the framed video, so it cannot run before)? [after Framing export] |

## Downstream impact (record in those tasks when this epic is placed)

- **T7630 / T7620 guided tour** anchors to Annotate controls and vocabulary that change here.
  The epic's step "rate + save, Clip Out Play" is already stale.
- **T10320 tutorial reshoot** must be shot after this ships.
- **T9720 release gate** path "two plays -> framed clip" changes to "rate Highlight -> Make
  Highlight Now".

## Completion Criteria

- [ ] All five tasks merged with Branch CI green
- [ ] Live-driven on desktop and a 393 px phone: mark play -> rating required -> Highlight ->
      Make Highlight Now lands in Frame Highlight on that clip; Keep Annotating lands the clip in
      Clips with the teaching line shown
- [ ] No "Create clip" / "Frame" CTA remains in Annotate; no "Brilliant" in shipped UI copy
- [ ] `.claude/knowledge/annotate.md` updated (stale `clipStage.createActions` line fixed)
