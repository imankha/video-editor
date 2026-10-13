# T12680: Status words: Clips "By game" legend still shows Done, Draft and two "In progress" entries

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-12
**Updated:** 2026-10-12
**Found by:** [T12590](../T12590-guide-coverage-and-responsive-sweep.md) live staging walk 2026-10-12 (severity MED). Evidence: [T12590 RESULTS](../../ux/2026-10-11-guide-coverage-sweep/RESULTS.md); screenshots in `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/`.

## Problem

T11940 holds on the tiles and tabs (only "In progress" and "Finished"; "Clipped", "Framed", "Spotlight started" and "Overlaid" appear nowhere at 1440, 768 or 390). But the Clips "By game" legend reads "Done, In Progress, In progress, Draft" (two entries differing only in capitalisation and colour, plus "Done" and "Draft" outside the vocabulary), and the same status group is listed twice for one game ([c-bygame-768](../../ux/2026-10-11-guide-coverage-sweep/screens/c-bygame-768.jpg)). "Not started" never appeared, even for a highlight that was made but not framed (shown "In progress"); confirm that is intended.

## Solution

Drive the legend from the same status enum as the tiles (Not started, In progress, Finished), merge duplicate groups, and add a test that the legend labels equal the tile labels.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/utils/draftStage.js`
- `src/frontend/src/modes/annotate/clipStage.js`

### Related Tasks

- Source: T12590 (this walk), T12580 (shaded guide steps), T12570 (polish bundle).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12680:`

## Acceptance Criteria

- [ ] Each observation above is fixed, or recorded as not reproducible with a screenshot
- [ ] Re-checked on staging at 1440x900, 1024x768, 768x1024 and 390x844
