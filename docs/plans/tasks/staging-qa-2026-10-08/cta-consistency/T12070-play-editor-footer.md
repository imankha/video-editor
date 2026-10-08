# T12070: Play editor footer: Done first, Delete last, one component

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 3: Styling and CTA consistency](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md) (screenshots next to it)

**Decision gate:** Q3 (see [decision register](../README.md#decision-register)). Implement the option the user ruled; the text below states the recommended option.

## Problem

The play editor footer exists in four copies (AnnotateFullscreenOverlay.jsx:552-564, :672-683, :787-797, :919-929) with four different Done class strings; Delete play (gray, red on hover, DeletePlayButton.jsx:84-93) is on the left and Done on the right: destructive first, main last (qa-10). Tags and notes open below this bar (see T12150).

## Solution

One PlayEditorFooter used by all four layouts: Done is primary and first; Delete is ghost-destructive and last with the inline confirm unchanged (per Q3); at least 44px on coarse pointers.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
- `src/frontend/src/modes/annotate/components/DeletePlayButton.jsx`

### Related Tasks

- T12010. Decision Q3. Do before T12150 (same file).

### Test first (red before green)

Spec: first cta-role in the editor footer is primary (fails today).

## Implementation

### Steps

1. [ ] Load the knowledge docs named in the epic; verify the Problem against current code (docs are claims, code is truth)
2. [ ] Write the failing test above and observe it fail for the intended reason
3. [ ] Implement the Solution (surgical diff, no reactive persistence, no silent fallbacks)
4. [ ] Run the named relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12070:` and the co-author line

### Progress Log

**2026-10-08**: Filed from the staging walkthrough (see findings). Root causes verified against master c6e6708fa by Opus expert agents.

## Acceptance Criteria

- [ ] Done first, Delete last in all four layouts
- [ ] Delete confirm unchanged
- [ ] Added to cta-consistency.spec.js at 390 and 1440
- [ ] Relevant tests pass and lint is clean
