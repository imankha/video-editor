# T14750: Edit play first on a selected play, guide explains both choices

**Status:** FOLDED into T14770 (2026-11-03)
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-03
**Updated:** 2026-11-03

> **2026-11-03:** superseded in scope by [T14770](T14770-single-highlight-entry-and-made-list.md) (one entry button + list of highlights made, which also puts Edit play first). The two open questions below are answered in T14770's design ([decision page](https://claude.ai/artifact/MggCeaBwWEqdgnAdkUjYhT)). Folded into T14770 on 2026-11-03 when the user picked the design; do not start this task separately.

## Problem

User feedback (2026-11-03, phone screenshot of Annotate with a play selected):

> "Consider moving edit play to be the top option and updating the guidance to also first explain that you can edit your play or create a highlight."

With a play selected, Mark plays (Annotate) shows two big cyan **Make highlight** cards (Portrait, Landscape) and then **Edit play** last, as a dimmer secondary card. On a phone the Make highlight cards fill the first screen, so a parent who just marked a play and wants to fix its timing, rating or tags has to scroll past the paid step to find Edit play. The order also reads as "the next step is to pay", before the parent has checked the play is right.

The guide for this state already names both actions (`GUIDE.annotate.selectedNone`: "Tap Make highlight to turn this play into a video, or Edit play to adjust it."), but it leads with Make highlight and pulses only the highlight slots. The 5-star rules (`annotate.progress.brilliant` "Brilliant play. Make a portrait highlight.") do not mention Edit play at all.

## Solution

**Vocabulary (Copy audit glossary, [copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md)):** the slot buttons keep **Make highlight** (user 2026-11-03: name the parent's goal; "Frame play" was dropped). T14620 renames the paid step inside Frame instead. Other words: **play**, **highlight**, **athlete**, **Brilliant** (5 stars), Tap not Click, no dashes, copy in `displayNames.js`.

1. **Order:** in the selected-play layout, render Edit play ABOVE the Portrait/Landscape Make highlight slots. Keep the slots as the primary-weight cards; Edit play keeps its secondary styling but comes first. Check desktop too (`sm:grid-cols-3` today puts Edit play in the right column; first column is the natural mirror).
2. **Guidance:** the first sentence for a selected play explains the two choices in the new order: you can edit the play (timing, rating, tags) or start a highlight from it. Suggested (see T14770): "You can edit this play or make a highlight from it. Tap Edit play to fix its timing, rating or tags, or Make highlight to turn it into a video you can share." Apply to `selectedNone`; decide with the user whether the 5-star `brilliant` sentence ("Brilliant play. Make a portrait highlight.") also gets the Edit play half or stays the strong portrait nudge. Its body "Focus the video on your athlete" uses the retired "Focus"; if T14620 has not already fixed it, use "Frame the video on your athlete." 
3. **Pulse:** the rule still pulses ONE thing. Recommendation: keep pulsing the highlight slots (the product goal), Edit play stays in `keepClear`. If the sentence leads with Edit play, confirm with the user whether the pulse should follow the sentence order (guidance invariant: pulse the control the sentence names).

Show the user a before/after mock (phone + desktop) before implementing (UX-expert pass rule).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/AnnotateModeView.jsx` (~L1341-1370) - `isEditMode` grid: `HighlightOrientationSlots` then the Edit play `ActionCard`; the T12040 comment explains why Edit play was put second, update it
- `src/frontend/src/config/displayNames.js` (~L726-728) - `GUIDE.annotate.selectedNone` / `brilliant` / `portrait` sentences
- `src/frontend/src/components/instructions/resolveGuide.js` (~L185-192) - `annotate.selected.none` and `annotate.progress.*` rules (pulse, keepClear, reveal)
- `src/frontend/src/modes/AnnotateModeView.highlightInstances.test.jsx`, `AnnotateModeView.cta.test.jsx` - existing layout tests to extend
- `src/frontend/src/components/instructions/resolveGuide.pulseTargets.test.js`, `guideRules.pulse.test.js` - guide rule guards

### Related Tasks
- Runs right after the Copy audit milestone (T14510-T14670). Depends on T14620 (paid step renamed inside Frame) and T14610 (Mark plays copy, same `GUIDE.annotate` strings). If either is still open, fold the sentence change into it instead of editing the same strings twice.
- T14760 (Frame guidance starts at step 2) is in the same follow-up section.
- Glossary: play / highlight, "Make highlight" is the paid step (see `copy-vocabulary/EPIC.md`).

### Technical Notes
- Knowledge docs: `.claude/knowledge/guidance.md`, `.claude/knowledge/annotate.md`.
- `annotate.selected.none` uses `reveal: true` (scrolls its pulse union on-screen once). With Edit play moved above the slots, re-check on a 390x844 phone that the reveal still lands both the card and the pulsed slot sensibly and the coach card does not cover Edit play.
- No persistence, no backend. Pure layout + copy.

## Implementation

### Steps
1. [ ] Mock phone + desktop order and the new sentence(s); get the user's pick (incl. pulse + brilliant-sentence questions)
2. [ ] Failing test: Edit play renders before the highlight slots in the selected-play layout; guide sentence names Edit play first
3. [ ] Reorder in `AnnotateModeView.jsx`, update the comment
4. [ ] Update `GUIDE.annotate` copy (and rule pulse if the user chose to change it)
5. [ ] Live-check phone 390x844 and desktop 1280x800 with Guidance on

### Progress Log

**2026-11-03**: Filed from user feedback with a phone screenshot.

## Acceptance Criteria

- [ ] With a play selected, Edit play is the first action card on phone and desktop
- [ ] The selected-play guide sentence first explains you can edit the play or make a highlight, using glossary words (Edit play, Make highlight, play, highlight)
- [ ] Guide pulse/keepClear still satisfy the guidance guard tests; coach card covers neither Edit play nor the pulsed control on a phone
- [ ] Relevant Annotate + guide tests pass
