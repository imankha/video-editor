# T6540: Card editor — the rail is hard to parse

**Status:** TODO
**Impact:** 6 | **Complexity:** 4
**Follows:** [T5205](T5205-card-editor-ui.md) (card editor, merged 2a3594a6)
**Sibling:** [T6530](T6530-intro-card-discoverability-ux.md) — that one is about FINDING the feature;
this one is about using it once you are in.

## Problem

User feedback on first real use, 2026-08-05: *"TBH this UX is hard to parse."*

The editor works and every control is correct. The problem is information design: the right rail is
a flat list of same-weight sections with no hierarchy, and two of its controls did not communicate
what they do at all.

Two were clear defects and are **already fixed** (commit `58d6eceb`):
- treatment swatches rendered only the backdrop, which is near-black for all three treatments, so
  gold / dark / photo-forward looked identical;
- the colour control showed quick-pick swatches AND a full-width native colour input below them —
  two affordances for one value.

What remains is a layout and hierarchy problem, which is a design judgement rather than a bug.

## What to look at

1. **The rail has no hierarchy.** Eight ALL-CAPS section labels at identical weight, in one scrolling
   column with its own scrollbar. Nothing separates *what is on the card* (facts, title text) from
   *how it looks* (treatment, font, colour, shadow, stroke) from *the photo*. Everything competes
   equally for attention, so nothing is findable.
2. **Zoom and Photo are one object split across two columns.** The zoom slider sits under the stage
   on the left; Remove / Replace sit in the rail on the right.
3. **The composition indicator looks like a debug label.** `title-only` is small grey text in the
   stage corner, yet it is the entire visible explanation of why ticking facts re-lays-out the card —
   the epic's most distinctive behaviour (decision 2: no template picker).
4. **The `TEXT → Title` chip is opaque.** It is a slot selector, but with one slot it reads as a
   stray button. Consider whether a selector should appear at all when there is nothing to choose.
5. **Fact rows read well** (`Position — CAM`) but the causal link from ticking one to the layout
   changing is not signposted anywhere except that corner badge.
6. **Check the modal's bounds.** In the reported screenshot a reel card ("Brilliant Dribble / Move to
   My Reels / Preview") appears inside the modal's left column below the motion-preview button.
   Determine whether that is the page behind showing through or genuinely misplaced content — if the
   latter, it is a layering bug and should be fixed regardless of the redesign.

## Method
- Drive the real editor on staging, with and without a photo, across all four compositions.
- Prefer consistency with existing panels (`OverlaySettingsCard` is the established rail precedent)
  over inventing a new pattern; `.claude/references/ui-style-guide.md` is the authority.
- **Bring a proposal with visuals to the user before implementing.** The controls are correct — this
  is about arranging them, and arrangement is a judgement call worth agreeing up front.

## Relevant files
- `src/frontend/src/components/introcards/IntroCardRail.jsx` — the rail
- `src/frontend/src/components/introcards/IntroCardStage.jsx` — stage, zoom, composition badge
- `src/frontend/src/components/textspec/TextSpecEditor.jsx` — shared, also hosted by T5225's overlay
  rail; changes must not regress that host
- `.claude/references/ui-style-guide.md`

## Classification hint
M-tier, frontend-only, no schema change. **ui-designer agent required**, with a user approval gate on
the proposal before code. Real-browser verification with before/after screenshots at desktop and 375px.

## Acceptance criteria
- [ ] A proposal with visuals is approved by the user before implementation.
- [ ] The rail has visible grouping so a user can find a control without reading every label.
- [ ] Photo controls and zoom are presented as one thing, not split across columns.
- [ ] The current composition is legible as product feedback, not a debug string.
- [ ] The slot selector is either explained or absent when there is nothing to select.
- [ ] The modal-bounds question (item 6) is resolved either way.
- [ ] `TextSpecEditor`'s other host (T5225 overlay text) is unaffected — its tests still pass.
- [ ] Before/after screenshots at desktop and 375px.
