# T10140: Draft carousel cluster doesn't use available horizontal width

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-09-15
**Updated:** 2026-09-15

## Problem

Found by the user while live-testing T10140's sibling task, T10110 (duplicate carousel controls
fix). On a wide viewport, a Reel Drafts "Draft"/"Not Started" phase bucket with only ONE game's
cluster (or generally fewer clusters than would fill the row) still caps that cluster at a fixed
`max-w-[420px]`, leaving most of the row's horizontal space empty even though there's nothing else
to fill it.

Screenshot evidence: a single-game "Draft (4)" bucket showing a ~420px-wide carousel with 2 cards
visible, while the rest of the row (a wide desktop viewport) sits empty.

## Root Cause

`src/frontend/src/components/ProjectManager.jsx:168`:
```js
const COMPACT_ROW_MAX_WIDTH = 'max-w-full sm:max-w-[420px]';
```
Applied per-game-cluster at `:192` (`DraftPhaseAspectRows`) regardless of how many other clusters
share the row or how much viewport width is actually available. This cap exists to keep
per-cluster carousels from stretching absurdly wide when several games' clusters need to
`flex-wrap` onto the same line (the scenario T10110 addresses) — but it applies unconditionally,
even to a bucket with just one cluster and nothing else on the row.

## Solution (not yet designed)

Not yet investigated in depth. Candidate directions:
1. Make the max-width conditional on cluster count in the row (similar to T10110's
   `byGame.length > 1` conditional) — a lone cluster could use a wider cap or no cap at all.
2. Let a cluster grow to fill remaining row space via flex-grow, capped only when siblings are
   present.

Whichever direction is chosen must not reintroduce T10110's bug (two+ clusters sharing a line
should still read as clearly separate groups, cap or no cap) — coordinate with T10110's divider
fix rather than replacing it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx:168` (`COMPACT_ROW_MAX_WIDTH` constant), `:190-195`
  (`DraftPhaseAspectRows` — applies the cap per cluster)

### Related Tasks
- Found while testing T10110 (duplicate carousel controls) — same component
  (`DraftPhaseAspectRows`), same "By Phase"/Draft bucket surface. Sequence after T10110 lands to
  avoid two concurrent edits to the same render logic.

### Technical Notes
- Purely a layout/CSS concern — no data model change expected.

## Implementation

### Steps
1. [ ] Reproduce on a wide viewport with exactly one game in the Draft bucket to confirm the wasted
   space.
2. [ ] Design the conditional/responsive width rule (see Solution above) — needs a UX call similar
   to T10110's, not obviously a single "correct" answer.
3. [ ] Implement + verify it doesn't regress T10110's divider fix when multiple clusters share a
   row.

### Progress Log

**2026-09-15**: Filed from user observation while live-testing T10110 on a running dev stack.

## Acceptance Criteria

- [ ] A Draft/Not-Started bucket with only one game's cluster (or otherwise fewer clusters than fit
      the row) uses the available horizontal width instead of stopping at a fixed 420px cap.
- [ ] Multiple clusters sharing a row still read as clearly separate groups (T10110's divider fix
      preserved).
