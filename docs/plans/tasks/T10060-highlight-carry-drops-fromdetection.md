# T10060: highlight_carry drops fromDetection on framing re-export, silently re-breaking Spotlight assignment persistence

**Status:** STAGING
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-14
**Updated:** 2026-09-14

## Problem

Found as a byproduct of the T9780 expert investigation (not part of the evaluation batch itself).
T9780 fixes the frontend `restoreRegions` path that was dropping `fromDetection` (the sole marker
of "this keyframe is a real player assignment") on reload. This task fixes a **second, server-side**
path with the identical symptom: any user who assigns a Spotlight player, then goes back and changes
their Focus/framing crop (triggering a re-export/carry), has that assignment silently demoted back
to unassigned scaffolding — re-opening "Pick your player" even after T9780 ships.

`src/backend/app/services/highlight_carry.py:188-198` merges only region-level metadata
(`{**base, **region}`); `region["keyframes"]` is replaced wholesale by
`transform_all_regions_to_working`. `transform_keyframe_to_working`
(`src/backend/app/highlight_transform.py:806-821`) returns a fixed key whitelist (`time, frame, x,
y, radiusX, radiusY, opacity, color, origin`) that does not include `fromDetection` — so the flag
never survives a framing re-export.

The verbatim fast-path (framing unchanged) and the legacy-carry path are unaffected — only an actual
re-transform (framing crop changed) hits this.

## Solution

Merge the transformed keyframe geometry back onto the prior keyframe by id+time (preserving
`fromDetection` when the prior keyframe had it), additive-only — mirrors the rule T9770 already
established for the backend `add_keyframe` UPDATE branch (never invent a false-positive marker on a
keyframe that didn't already have one).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/highlight_carry.py` - `_transform_single_clip` / `_transform_multi_clip` (around lines 188-198)
- `src/backend/app/highlight_transform.py` - `transform_keyframe_to_working` key whitelist (lines 806-821)
- `.claude/knowledge/keyframes-framing.md` - read first per project convention (Spotlight/keyframe invariants, T350 corruption history)

### Related Tasks
- Found during: T9780 (docs/plans/tasks/evaluation-2026-09-13/T9780.md) — fixes the frontend twin of this bug (`useHighlightRegions.js` restoreRegions)
- Precedent: T9770 (docs/plans/tasks/evaluation-2026-09-13/T9770.md) — established the additive-only `fromDetection` rule for the backend UPDATE branch

### Technical Notes
Migration NOT required — this is a write-path bug (data was never persisted with the flag on
re-transform), not existing corrupted data to backfill. Per house rule ("correct data, not
workarounds"): fix the write path; do not add a runtime fixup that re-derives `fromDetection` at
read time.

## Implementation

### Steps
1. [ ] Read `.claude/knowledge/keyframes-framing.md` for the carry/transform invariants before touching this.
2. [ ] Write a failing test: assign a Spotlight player (keyframe with `fromDetection: true`), trigger
   a framing re-export that changes the crop, and assert the transformed keyframe still carries
   `fromDetection: true`.
3. [ ] Add the id+time merge in `_transform_single_clip` / `_transform_multi_clip` (or in
   `transform_keyframe_to_working` itself if that's the cleaner seam) that preserves `fromDetection`
   from the prior keyframe onto the transformed one, additive-only (never sets it on a keyframe that
   didn't already have it).
4. [ ] Confirm existing highlight_carry / highlight_transform tests still pass.

## Acceptance Criteria

- [ ] A Spotlight player assignment survives a framing re-export (crop change) that triggers the
  carry/transform path.
- [ ] Legacy keyframes without `fromDetection` never gain a false-positive marker.
- [ ] The verbatim fast-path and legacy-carry path remain unaffected (regression-tested).
- [ ] Tests pass (targeted backend set: highlight_carry, highlight_transform, overlay keyframe tests).
