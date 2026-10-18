# T13050: Finished viewer header: Guidance switch over Download at 390, title truncated at 768

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Tier:** S (frontend)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-18 ([RESULTS.md section 10](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only, under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk.

## Problem

In the Finished viewer, at 390 the Guidance switch sits on top of the Download button and the header row clips at the left edge; at 768 the highlight title truncates to "0...". Evidence: r2-share-modal-390, r2-share-modal-768. Related to T12670, which covered the title, tabs and breadcrumb only.

## Solution

Lay the header out so the Guidance switch, title and Download never overlap at 390, and the title shows at least its first words at 768 (wrap, or move the switch).

## Context

### Relevant Files
- `src/frontend/src/` Finished viewer header
- Related: T12670

### Related Tasks
- Found by T12590 (2026-10-18 re-walk)

## Acceptance Criteria

- [ ] No overlap between the Guidance switch and Download at 390 (geometry test)
- [ ] No horizontal clipping of the header row at 390
- [ ] The title is readable at 768
