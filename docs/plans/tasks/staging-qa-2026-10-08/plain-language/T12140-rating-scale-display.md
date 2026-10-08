# T12140: Rating scale: each option shows its own star count

**Status:** WIP
**Impact:** 6
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q8 (see [decision register](../README.md#decision-register)). RULED 2026-10-08: the recommended option was approved (exceptions: Q15 = C, Q16 = A); the text below states the ruled option.

## Problem

PlayRatingRow.jsx:60,90-95: filled = value <= rating so at 5 every cell shows the same filled star and no cell shows a count (qa-10); adjectives in components/shared/clipConstants.js:10-16; 'Mental Lapse' / 'Technical Lapse' are coaching terms and feed generated play names (generateClipName). T11840 shipped the labelled row but not this.

## Solution

Per decision Q8. Recommended A: cell n renders n Lucide Star icons (size 10, flex gap-px) with the adjective below; unselected text-gray-400 unfilled, selected stars filled #fbbf24 with border-white (gold cell for 5); about 54px of stars at 390px; caption line unchanged. Separate sub-decision: rename 'Mental Lapse' / 'Technical Lapse' to 'Decision miss' / 'Skill miss' (or keep).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/annotate/components/PlayRatingRow.jsx`
- `src/frontend/src/components/shared/clipConstants.js`
- `PlayRatingRow/RatingPill tests`
- `src/frontend/e2e/T10760*`

### Related Tasks

- Decision Q8. Do not redo T11840.

### Test first (red before green)

Unit: the 5-star cell renders five Star icons and the 1-star cell one (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12140:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Each cell shows its own star count (option A)
- [ ] Adjectives per the ruling
- [ ] Radio a11y unchanged
- [ ] Relevant tests pass and lint is clean
