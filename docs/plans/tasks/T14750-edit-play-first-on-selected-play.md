# T14750: Edit play first on a selected play, guide explains both choices

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

User feedback (2026-11-03, phone screenshot of Annotate with a play selected):

> "Consider moving edit play to be the top option and updating the guidance to also first explain that you can edit your play or create a highlight."

With a play selected, Annotate shows two big cyan **Make highlight** cards (Portrait, Landscape) and then **Edit play** last, as a dimmer secondary card. On a phone the Make highlight cards fill the first screen, so a parent who just marked a play and wants to fix its timing, rating or tags has to scroll past the paid step to find Edit play. The order also reads as "the next step is to pay", before the parent has checked the play is right.

The guide for this state already names both actions (`GUIDE.annotate.selectedNone`: "Tap Make highlight to turn this play into a video, or Edit play to adjust it."), but it leads with Make highlight and pulses only the highlight slots. The 5-star rules (`annotate.progress.brilliant` "Brilliant play. Make a portrait highlight.") do not mention Edit play at all.

## Solution

1. **Order:** in the selected-play layout, render Edit play ABOVE the Portrait/Landscape highlight slots. Keep the slots as the primary-weight cards; Edit play keeps its secondary styling but comes first. Check desktop too (`sm:grid-cols-3` today puts Edit play in the right column; first column is the natural mirror).
2. **Guidance:** the first sentence for a selected play explains the two choices in the new order: you can edit the play (timing, rating, tags) or make a highlight from it. Suggested: "Edit play to fix its timing, rating or tags, or Make highlight to turn it into a video." Apply to `selectedNone`; decide with the user whether the 5-star `brilliant` sentence also gets the Edit play half or stays the strong portrait nudge.
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
- Coordinate with T14620 (Frame and paid step copy) and T14640 (guidance copy): same `GUIDE.annotate` strings. Land after them or fold the sentence change into whichever is in flight.
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
- [ ] The selected-play guide sentence first explains you can edit the play or make a highlight
- [ ] Guide pulse/keepClear still satisfy the guidance guard tests; coach card covers neither Edit play nor the pulsed control on a phone
- [ ] Relevant Annotate + guide tests pass
