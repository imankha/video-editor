# T12050: 'Make this a highlight now?' card on CtaBar, one primary colour

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 3: Styling and CTA consistency](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

HighlightChoiceCard.jsx:57-81 renders the only gold (#F5B700) full-width button in the app, then a gray bordered 'Keep Marking Plays' stacked below; the Guidance toggle covers its right end (qa-13).

## Solution

Make Highlight Now becomes the cyan primary, first; gold limited to the card's eyebrow and border (rating-5 semantics); testids highlight-choice-now and highlight-choice-later kept; Escape and X behaviour unchanged.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/annotate/components/HighlightChoiceCard.jsx`

### Related Tasks

- T12010, T11950.

### Test first (red before green)

Spec assertion that the card has exactly one primary and it is leftmost/topmost (fails today: gold button).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12050:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Primary is cyan and first; gold only as eyebrow/border
- [ ] Testids unchanged
- [ ] Added to cta-consistency.spec.js
- [ ] Relevant tests pass and lint is clean
