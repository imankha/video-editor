# T12660: Guide has no finished-highlight count: after two exports it repeats the basics and never points at the next export

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-12
**Updated:** 2026-10-12
**Found by:** [T12590](../T12590-guide-coverage-and-responsive-sweep.md) live staging walk 2026-10-12 (severity MED). Evidence: [T12590 RESULTS](../../ux/2026-10-11-guide-coverage-sweep/RESULTS.md); screenshots in `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/`.

## Problem

Checked on staging with 1 and then 2 finished highlights (same account). The guide is identical in both: Home Games "Your highlight is ready to share. Open Finished.", Focus "Step 1 of 5 Drag the box onto your athlete", Annotate "Tap Edit play to adjust this play." Nothing invites the advanced controls (aspect ratio, trim, straighten, background dim, text, spotlight) once two highlights exist ([t2-finished-tab-1440](../../ux/2026-10-11-guide-coverage-sweep/screens/t2-finished-tab-1440.jpg)). The Finished tab with two collapsed highlights has no guide at all, the first-finish guide ends at sharing instead of "mark another play", and "Mark more plays" on the empty Clips state lands on the Games list, not an open game.

## Solution

Add `finishedCount` to the editor and Home guide facts, add a second copy tier (2+ finished: invite one advanced control per screen; fewer than 2: core path only), give the Finished tab with 2+ highlights a guide, and make the end of the first-finish path point at marking the next play. This is the likely child T12590 named.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/instructions/catalog.js`
- `src/frontend/src/components/instructions/resolveGuide.js`
- `src/frontend/src/config/displayNames.js`

### Related Tasks

- Source: T12590 (this walk), T12580 (shaded guide steps), T12570 (polish bundle).

## Implementation

### Steps

1. [ ] Load the matching `.claude/knowledge/` doc and reproduce at the sizes named above
2. [ ] Failing behavioral test first, observe red for the intended reason
3. [ ] Implement, run the curated relevant test set and explicit lint
4. [ ] Commit with subject starting `T12660:`

## Acceptance Criteria

- [ ] Each observation above is fixed, or recorded as not reproducible with a screenshot
- [ ] Re-checked on staging at 1440x900, 1024x768, 768x1024 and 390x844
