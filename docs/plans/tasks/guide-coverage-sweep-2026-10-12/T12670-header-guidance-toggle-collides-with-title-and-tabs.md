# T12670: Header: Guidance toggle collides with the wordmark, mode tabs and breadcrumb at 768 and 1024

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** S
**Created:** 2026-10-12
**Updated:** 2026-10-12
**Found by:** [T12590](../T12590-guide-coverage-and-responsive-sweep.md) live staging walk 2026-10-12 (severity MED). Evidence: [T12590 RESULTS](../../ux/2026-10-11-guide-coverage-sweep/RESULTS.md); screenshots in `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/`.

## Problem

- 768x1024 Focus: the toggle sits on top of the "Mark Plays" tab; the two labels print over each other ("GuidanceMark Play") ([f1-768](../../ux/2026-10-11-guide-coverage-sweep/screens/f1-768.jpg)).
- 768x1024 Home: the toggle overlaps the "ReelBallers" wordmark ([c-bygame-768](../../ux/2026-10-11-guide-coverage-sweep/screens/c-bygame-768.jpg)).
- 1024x768 Annotate and Focus: the toggle and credit pill crowd the breadcrumb down to "Ga" and "Pla..." ([a-open-1024](../../ux/2026-10-11-guide-coverage-sweep/screens/a-open-1024.jpg)).
- 390 Focus: the toggle covers the framing-status icon beside the credit pill ([f-free-390](../../ux/2026-10-11-guide-coverage-sweep/screens/f-free-390.jpg)).

At 1440 and on Home at 390 the header is clean.

## Solution

Give the header a layout that reserves the toggle's width (flex row with the toggle as a flex item, mode tabs wrap under at 768 and below). Test that the toggle and its neighbours do not intersect at 768, 1024 and 390.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/GuidanceToggle.jsx`
- `src/frontend/src/components/shared/ModeSwitcher.jsx`

### Related Tasks

- Source: T12590 (this walk), T12580 (shaded guide steps), T12570 (polish bundle).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12670:`

## Acceptance Criteria

- [ ] Each observation above is fixed, or recorded as not reproducible with a screenshot
- [ ] Re-checked on staging at 1440x900, 1024x768, 768x1024 and 390x844
