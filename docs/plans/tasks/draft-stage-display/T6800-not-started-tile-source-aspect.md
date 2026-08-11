# T6800: Not Started tiles render at source aspect

**Status:** WAITING ON USER
**Impact:** 6
**Complexity:** 2
**Created:** 2026-08-11
**Updated:** 2026-08-11

Epic: [Draft Stage Display](EPIC.md) — child 1/3. Wanted inside the 2026-08-11 code-freeze build.

## Problem

A "Not Started" draft (no framing, no working/final video) renders as a portrait 9:16 tile
because `DraftTile` sizes from `project.aspect_ratio` — the project's TARGET output ratio,
which defaults to 9:16 before the user has done anything. But the draft's poster is a frame
extracted from the SOURCE at source aspect (`poster.py::ensure_draft_poster` →
`extract_clearest_frame_jpeg`, aspect preserved, typically 16:9 landscape game footage).
`object-cover` then center-crops the landscape frame into the portrait shell: the tile shows
a vertical sliver that misrepresents footage the user hasn't cropped yet.

## Solution

When a draft is in the Not Started stage (stage derivation in EPIC.md), size the tile with
the LANDSCAPE size class (`aspect-video`) instead of reading `project.aspect_ratio`. The
poster fills it naturally since it is already source-aspect.

Pragmatic freeze-friendly simplification: treat "source aspect" as landscape 16:9. Game
footage is landscape in practice, and the tile is a ~200px thumbnail — a rare 4:3 source
center-crops harmlessly. A later refinement could read the poster's
`naturalWidth/naturalHeight` (the backend already stores width/height as R2 metadata on the
poster object) but that introduces per-tile layout shift; NOT in scope.

Row-height consistency: on its own this puts a landscape tile into the portrait `byAspect`
row. T6810 (stage rows) resolves that properly — Not Started gets its own row. If T6800
ships alone even briefly, `splitByAspect`'s input must treat Not-Started drafts as landscape
so they land in the landscape row (ship T6800 + T6810 together to avoid caring).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DraftTile.jsx` — `sizeClass` selection (~line 374); add
  not-started stage check alongside `isLandscape`
- `src/frontend/src/components/ProjectManager.jsx` — only if shipped without T6810 (aspect
  bucketing input); with T6810 the stage row owns placement
- `src/frontend/src/components/DraftTile.test.jsx` — aspect assertions

### Related Tasks
- Blocks / ships with: T6810
- T6820 reuses the landscape shell for the source-clip preview

### Technical Notes
- View-only; no persistence, no API change, no store change.
- Stage predicate must match EPIC.md exactly:
  `!has_final_video && !has_working_video && clips_in_progress === 0 && clips_exported === 0 && !has_overlay_edits`.
  Extract it as a small exported helper (e.g. `getDraftStage(project)`) so DraftTile,
  ProjectManager, and tests share one derivation (no-redundant-state rule).
- The status chip ("Not started") already computes an equivalent condition in DraftTile —
  fold both onto the shared helper rather than duplicating.

## Implementation

### Steps
1. [ ] Add `getDraftStage(project)` helper (pure, exported; unit-tested)
2. [ ] DraftTile: `sizeClass` uses landscape when stage === NOT_STARTED
3. [ ] Unit test: not-started project → `aspect-video` class; in-framing 9:16 project → portrait
4. [ ] Visual check in real browser (drive-app-as-user) on a game with mixed-stage drafts

## Acceptance Criteria

- [ ] A game's un-started drafts render landscape with the full source frame visible
- [ ] In Framing / In Overlay / Ready tiles keep their current target-aspect shells
- [ ] No row contains mixed tile heights (with T6810)
- [ ] Existing DraftTile tests pass
