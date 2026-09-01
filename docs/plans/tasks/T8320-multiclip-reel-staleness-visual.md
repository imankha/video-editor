# T8320: Multi-clip reel staleness - visual cue on Reel Drafts / Focus clip list

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-01

## Problem

T8070 built the full per-clip "reel source window" data model (which clips of a reel
have drifted from the boundaries that actually produced the reel's exported video) and
surfaced it for every clip via `GET /projects/{id}/clips` (`WorkingClipResponse.
reel_source_start_time`/`reel_source_end_time`). It also implemented the DISPLAY for the
single-clip/seed case in annotate's `ClipDetailsEditor`.

What's missing: for a MULTI-clip reel, there is no rendered indicator anywhere that a
specific clip has drifted. The two surfaces that actually render a multi-clip reel's
per-clip state - Reel Drafts' `DraftTile` + `SegmentedProgressStrip` (one segment per
clip) and the Focus clip list - show no staleness cue today. This was scoped out of
T8070 deliberately (Option A, user-approved 2026-09-01): ship the data model correctly
now, do the visual as a follow-up once it has design input.

## Solution (needs a ui-designer pass before implementation)

- Data is already available: per clip, compare live `start_time`/`end_time` (already in
  `WorkingClipResponse`) against `reel_source_start_time`/`reel_source_end_time` (same
  exact-equality rule as T8070's annotate implementation - no epsilon).
- Needs a `ui-designer` spec for what a "stale segment" looks like and where it lives -
  e.g. an amber tint on the affected segment in `SegmentedProgressStrip` + a tooltip
  ("clip edited since this reel was made"), and/or an indicator in the Focus clip list.
- Implementation should reuse the exact comparison rule T8070 established (§4 of
  `T8070-design.md`: exact `===`, values copied verbatim with no arithmetic) rather than
  re-deriving it.

## Context

### Relevant Files (anticipated)
- `src/frontend/src/components/DraftTile.jsx` / `SegmentedProgressStrip` (per T8070's
  design doc §7.Q5, referenced as `annotate.md` T7790b) - per-clip segment rendering
- Focus clip list component (locate at pickup)
- `GET /projects/{id}/clips` (`clips.py`) - already returns the per-clip snapshot fields,
  no backend change anticipated unless the ui-designer spec needs additional data

### Related Tasks
- Split out of [T8070](T8070-reel-status-timestamp-staleness.md) (Q5, Option A) - the
  data model and single-clip/seed display are already shipped; this is the multi-clip
  visual only.

## Acceptance Criteria

- [ ] ui-designer spec approved for the stale-segment visual + copy
- [ ] A multi-clip reel with one drifted clip shows the cue on exactly that clip's
      segment, not the whole reel
- [ ] Reverting that clip's boundaries to the exact producing values clears the cue
