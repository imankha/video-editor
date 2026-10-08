# T12150: Play editor: tags and notes open above the Done bar

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 2: Confusing moments and jargon](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

## Problem

AnnotateFullscreenOverlay.jsx:669-682 places the footer before the details panel (:687) 'to keep primary actions ahead on tablet-height', so expanding 'Add Tags and Notes' puts the tags section below Done/Delete (qa-11), reading as a different screen.

## Solution

Render the details panel before the footer, capped at max-h-64 overflow-y-auto (the style guide's details-panel pattern) so the footer is never pushed off tablets; footer stays pinned at the bottom of the card.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
- `progressBadges test`

### Related Tasks

- After T12070 (same file).

### Test first (red before green)

Playwright at 768x1024: open details, assert the footer stays inside the card and below the details panel (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12150:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Opening details never pushes Delete/Done below the card
- [ ] Panel scrolls inside max-h-64
- [ ] 768x1024 check
- [ ] Relevant tests pass and lint is clean
