# T12710: Guide coverage gaps: Focus settings, sport picker, Edit game, billing, Finished with 2+, signed-out

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** M
**Created:** 2026-10-12
**Updated:** 2026-10-12
**Found by:** [T12590](../T12590-guide-coverage-and-responsive-sweep.md) live staging walk 2026-10-12 (severity MED). Evidence: [T12590 RESULTS](../../ux/2026-10-11-guide-coverage-sweep/RESULTS.md); screenshots in `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/`.

## Problem

Screens that have no guide today (RESULTS.md lists the rest). Decide per screen: add a guide or record "needs none". Recommendation: the Focus settings panel "More options" (aspect ratio, straighten, background dim) gets a guide once the user has finished a highlight (needs T12660's count); the "What sport is this?" picker needs none (self-explanatory, has Skip); Edit Game Details needs none; Buy Credits and the Account menu need none; the Finished tab with 2+ collapsed highlights gets one (T12660); sign-in needs none; recipient share and claim pages were not walked.

## Solution

File follow-up work only where a guide is chosen; otherwise record the "needs none" ruling in RESULTS.md.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/resolveGuide.js`

### Related Tasks

- Source: T12590 (this walk), T12580 (shaded guide steps), T12570 (polish bundle).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12710:`

## Acceptance Criteria

- [ ] Each observation above is fixed, or recorded as not reproducible with a screenshot
- [ ] Re-checked on staging at 1440x900, 1024x768, 768x1024 and 390x844
