# T12690: Escape closes the play editor behind a guide; Buy Credits and Edit Game ignore Escape; card actions bleed over Buy Credits

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Tier:** S
**Created:** 2026-10-12
**Updated:** 2026-10-12
**Found by:** [T12590](../T12590-guide-coverage-and-responsive-sweep.md) live staging walk 2026-10-12 (severity MED). Evidence: [T12590 RESULTS](../../ux/2026-10-11-guide-coverage-sweep/RESULTS.md); screenshots in `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/`.

## Problem

- Pressing Esc to dismiss a guide step in the play editor also closed the editor underneath (768x1024 and 1440), so Got it by keyboard discards the user's place.
- Escape does not close Buy Credits or Edit Game Details (the upload modal does, T12570); the Buy Credits close X is 20x20 and Cancel is 36 px high at 390.
- 1440 Finished tab: a card's Play and Share pills render above the Buy Credits modal ([t1-account-1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t1-account-1440.jpg)).

## Solution

Stop propagation when the coach consumes Esc; give every modal the same Escape and Close contract as the upload modal; fix the z-order of card overlays; make the Buy Credits X 44 px.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/FloatingCoach.jsx`
- `src/frontend/src/components/BuyCreditsModal.jsx`

### Related Tasks

- Source: T12590 (this walk), T12580 (shaded guide steps), T12570 (polish bundle).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12690:`

## Acceptance Criteria

- [ ] Each observation above is fixed, or recorded as not reproducible with a screenshot
- [ ] Re-checked on staging at 1440x900, 1024x768, 768x1024 and 390x844
