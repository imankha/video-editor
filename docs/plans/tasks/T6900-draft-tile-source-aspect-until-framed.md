# T6900: Draft reel card should stay in source aspect until framing is actually applied

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-12
**Updated:** 2026-08-12

## Problem

User report 2026-08-12: "for any draft reel that hasn't been framed, its card should be in
the source video's aspect ratio."

T6800/T6810 (merged, STAGING) already force source aspect (landscape) for drafts at the
`NOT_STARTED` stage (`DraftTile.jsx:404-408`, `isLandscape = ... || isNotStarted`). But
`getDraftStage` (`draftStage.js:47-58`) buckets a draft into `IN_FRAMING` as soon as
`clips_in_progress > 0 || clips_exported > 0 || has_overlay_edits` — i.e. the moment clips
are extracted and the draft enters the Framing screen, BEFORE the user has actually applied
any crop/framing keyframes. For that in-between window, `isNotStarted` is false, so the tile
falls through to `project.aspect_ratio` (the TARGET output ratio, portrait by default) even
though no real framing has happened yet — the exact gap the user is describing. "Hasn't been
framed" is a broader condition than "not started."

## Solution

Distinguish "entered the Framing stage" from "has actually applied framing" (crop keyframes
exist / a crop has been committed). Extend the tile's landscape-override condition to cover
`IN_FRAMING` drafts that have no real crop data yet, not just `NOT_STARTED` drafts. Once
actual framing exists (crop keyframes present), the tile should render at the target aspect
as it does today.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/draftStage.js:8-58` — `DRAFT_STAGE` enum, `getDraftStage()`
  bucketing logic (`IN_FRAMING` trigger conditions), header comment already documents the
  "Not-Started drafts render landscape... two halves of the same row-height invariant" pairing
  with `DraftTile.jsx` — this task adds a THIRD condition to that pairing, update the comment.
- `src/frontend/src/components/DraftTile.jsx:404-408` — the aspect decision:
  `isLandscape = project.aspect_ratio === RATIO.LANDSCAPE || isNotStarted`. Needs a third
  disjunct for "IN_FRAMING but no crop keyframes yet."
- `src/frontend/src/utils/draftStage.js:70+` (`stageRowsFor`) — currently gives NOT_STARTED
  a null-ratio single row (no aspect split) because all its tiles render landscape
  uniformly; check whether IN_FRAMING-but-unframed drafts need the same treatment or whether
  mixing them into IN_FRAMING's existing aspect-split rows is acceptable (they'd be a THIRD
  effective shape within one stage-row otherwise — verify against the row-height invariant
  the header comment calls out).
- `src/frontend/src/components/DraftTile.test.jsx:267,273,283` — existing aspect assertions
  for not-started vs in-framing vs target-9:16; add the new in-framing-but-unframed case here.
- **Needs identification during implementation**: the exact signal for "framing actually
  applied" (crop keyframes exist) — likely a field already present on the project/clip
  payload (check what backend endpoint feeds `ProjectManager`'s project list — may need a
  `has_crop_keyframes` / `is_framed` style boolean, or it may already be derivable from
  existing fields without a backend change). Confirm before assuming a backend change is
  needed.

### Related Tasks
- T6800/T6810 (Draft Stage Display epic) — this task extends their exact invariant, not a
  separate mechanism. Read `docs/plans/tasks/tile-video-preview/` or wherever the T6800/T6810
  task files live for the full stage-derivation design intent before changing it.

### Technical Notes
- Keep `getDraftStage`'s stage BUCKETING unchanged (IN_FRAMING should still mean what it
  means for stage-row grouping/labels) — this is specifically about the ASPECT/tile-sizing
  decision, which may need to diverge from the stage bucket for this one case. Don't
  conflate "which stage row does this draft appear in" with "what aspect does its tile
  render at" — they were the same signal before this task, won't be after.
- No persistence/backend change unless investigation shows the frontend genuinely lacks the
  crop-keyframes-presence signal it needs — check first.

## Implementation

### Steps
1. [ ] Confirm the exact signal for "framing has been applied" (crop keyframes present) is
       available on the project payload DraftTile already receives; if not, trace where to
       add it (read-only check first, don't assume a backend change is needed)
2. [ ] Extend `DraftTile.jsx`'s `isLandscape` condition to cover IN_FRAMING-but-unframed
       drafts
3. [ ] Update `draftStage.js`'s header comment / `stageRowsFor` row-grouping if the
       IN_FRAMING stage now needs to split unframed vs framed the same way NOT_STARTED gets
       its own row
4. [ ] Tests: IN_FRAMING + no crop keyframes -> source aspect; IN_FRAMING + crop keyframes
       present -> target aspect (existing behavior, must not regress)
5. [ ] Live-drive: extract clips from a game (enters Framing, no crop yet) -> confirm tile
       shows source/landscape aspect; apply a crop -> confirm tile switches to target aspect
6. [ ] Lint + relevant test set green

### Progress Log

**2026-08-12**: Filed from user report; gap identified against the just-merged T6800/T6810
stage-display logic (IN_FRAMING bucket doesn't distinguish "entered framing" from "actually
framed").

## Acceptance Criteria

- [ ] A draft with clips extracted but no crop/framing applied yet renders its tile at the
      source video's aspect ratio, not the target output ratio
- [ ] A draft that has been through Framing (crop keyframes exist) renders at target aspect,
      unchanged from current behavior
- [ ] NOT_STARTED behavior (T6800) unchanged
- [ ] Tests pass
