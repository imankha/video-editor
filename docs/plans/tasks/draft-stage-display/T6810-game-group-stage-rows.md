# T6810: Game group: one row per stage

**Status:** WAITING ON USER
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-11
**Updated:** 2026-08-11

Epic: [Draft Stage Display](EPIC.md) — child 2/3. Wanted inside the 2026-08-11 code-freeze
build; ship together with T6800.

## Problem

Inside a game group in Reel Drafts, all drafts render in aspect-split carousel rows
(`groups[key].byAspect`, one row per aspect ratio present — T5673/Q5). Stage is only visible
per-tile via the small status chip and progress strip. The user wants the group itself to
communicate pipeline position: clips separated onto different lines by stage —
**Not Started / In Framing / In Overlay / Ready**.

## Solution

Replace the game group's aspect-split rows with stage-split rows, in pipeline order
(Not Started → In Framing → In Overlay → Ready). Within each stage row, keep the existing
`splitByAspect` sub-split ONLY if both aspects are actually present in that stage (preserves
the row-height-consistency invariant the aspect split exists for). With T6800, Not Started
rows are all-landscape by construction.

Each stage row gets a small left-aligned label (stage name + count), styled like the
existing aspect chip the byAspect rows use. Rows for empty stages are not rendered.
Within-row ordering keeps the existing `compareGameTime` sort (T4080).

Ungrouped drafts (`ungroupedByAspect`, no game key) are OUT of scope — they keep the
aspect split.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` — `groupedProjects` memo (~line 365):
  replace `byAspect` with `byStage` (each stage → aspect sub-rows); render loop
  (~lines 1230–1260) renders stage-labeled rows
- `src/frontend/src/components/DraftTile.jsx` — source of the shared `getDraftStage`
  helper (created by T6800; move to a shared util if cleaner)
- `src/frontend/src/constants/aspectRatios.js` — `splitByAspect` (reused inside each stage)
- ProjectManager grouping tests (or new `ProjectManager.grouping.test.jsx`)

### Related Tasks
- Depends on: T6800 (shared stage helper; landscape Not-Started tiles keep rows uniform)

### Technical Notes
- Pure view/grouping change; `statusCounts`, header badges, filters, and legend stay
  whole-game and untouched.
- Stage derivation = the shared `getDraftStage` helper; do NOT re-derive inline
  (`getProjectStatusCounts` already encodes the same buckets for counts — leave it as is
  or fold it onto the helper if trivial).
- The status filter (`statusFilter`) already filters projects before grouping; a filtered
  group naturally renders only the matching stage rows.
- Keep the DOM/carousel structure of a row identical to today's aspect rows (snap
  scrolling, chips) so no CSS regressions.

## Implementation

### Steps
1. [ ] Add `splitByStage(projects)` → ordered `[{ stage, byAspect: [...] }]`, unit-tested
2. [ ] `groupedProjects` memo computes `byStage` per group
3. [ ] Render: one labeled row per (stage × aspect-present) in pipeline order
4. [ ] Unit tests: mixed-stage game → correct rows/order/labels; single-stage game → one
       unlabeled-or-labeled row (decide: label always shown for clarity)
5. [ ] Real-browser check on a game with all four stages present

## Acceptance Criteria

- [ ] A game with mixed-stage drafts shows one labeled line per stage present, in
      pipeline order
- [ ] No mixed tile heights within any row
- [ ] Games where every draft is in one stage render one row (no visual regression shock)
- [ ] Filters, counts, legend unchanged
- [ ] Tests pass
