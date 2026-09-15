# T10140: Draft carousel cluster doesn't use available horizontal width

**Status:** STAGING
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
1. [x] Reproduce on a wide viewport with exactly one game in the Draft bucket to confirm the wasted
   space.
2. [x] Design the width rule — moot once T10110 landed as one-game-per-row: every cluster is now
   guaranteed alone on its row, so there's no longer a case where a wide cap needs to protect a
   shared line. No conditional needed.
3. [x] Implement + verify it doesn't regress T10110 (they now share the fix: no multiple clusters
   ever share a row to begin with).

### Progress Log

**2026-09-15**: Filed from user observation while live-testing T10110 on a running dev stack.

**2026-09-15 (same session)**: Implemented immediately after T10110 landed, on the same branch
(`feature/T10110-draft-carousel-group-divider`) — T10110's one-game-per-row layout made this the
natural next step: `COMPACT_ROW_MAX_WIDTH` changed from `'max-w-full sm:max-w-[420px]'` to just
`'max-w-full'` (`ProjectManager.jsx:168`). No conditional/responsive logic needed: since a cluster
can no longer share a row with another (T10110), the old cap's only job — keeping several small
clusters from fighting for room on one line — no longer applies; `CardCarousel` still gets a
bounded container (the row's own available width) so its overflow/arrow detection is unaffected.

**2026-09-15 (verified + merged)**: User live-tested on the same restarted stack as T10110 and
confirmed a solo game's cluster now fills the row. Merged together with T10110 as PR #441.

## Acceptance Criteria

- [x] A Draft/Not-Started bucket with only one game's cluster (or otherwise fewer clusters than fit
      the row) uses the available horizontal width instead of stopping at a fixed 420px cap.
      User-confirmed live 2026-09-15.
- [x] Moot by construction: T10110 now guarantees one cluster per row, so no two clusters ever
      share a row to begin with.
