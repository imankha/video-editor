# T12380: Edit play card accessible name needs a separator

**Status:** STAGING (PR #591 merged)
**Impact:** 2
**Complexity:** 1
**Tier:** S
**Created:** 2026-10-10
**Updated:** 2026-10-10
**Found by:** [T12320](T12320-restore-frontend-unit-tests-green.md) item 5

## Problem

The Edit play card's accessible name runs the title into the description with no separator ("Edit playAdjust the timing..."). Screen readers read it as one garbled word. Tests currently match `/^edit play/i`.

## Solution

Separate title and description in the card (for example `aria-label` or a visually hidden separator) so the name reads "Edit play. Adjust the timing...". Keep the test matching the title.

## Context

### Relevant Files (REQUIRED)

- The Annotate action card component for Edit play (find via `annotate-primary-cta` in `src/frontend/src/modes/`)
- `src/frontend/src/modes/AnnotateModeView.*.test.jsx` (tests matching `/^edit play/i`)

### Related Tasks

- Found by T12320; may also surface in the T12310 walkthrough.

## Implementation

### Steps

1. [ ] Failing test asserting the accessible name has a separator
2. [ ] Fix the card markup
3. [ ] Commit with subject starting `T12380:`

## Acceptance Criteria

- [ ] Accessible name reads title, separator, description
- [ ] Relevant Annotate tests pass
