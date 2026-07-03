# T4450: Shared KeyframeTrack Timeline Rendering

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-03
**Epic:** [keyframe-unification](EPIC.md) · Audit item C4 · Depends on T4440

## Problem

Keyframe-track rendering (frame→percent positioning, visibility filtering, selection highlight, `KeyframeMarker` props) is implemented separately in `modes/framing/layers/CropLayer.jsx:106-171` and `components/timeline/RegionLayer.jsx` (highlight mode). They diverged into a LIVE bug: delete gating.

- CropLayer (flat-list model, correct): `showDeleteButton={visibleKeyframes.length >= 1}` (:167)
- RegionLayer's highlight lineage (dead permanent-keyframe model): `visibleKeyframes.length > 2 && !isPermanent`

That divergence IS the known **"can't delete first keyframe"** bug (memory "Keyframe flat-list model"): the flat-list fix reached crop but not highlight.

## Solution

Extract `components/timeline/KeyframeTrack.jsx`:

- Props: `keyframes`, `framerate`, frame→pixel/percent transform (or duration + zoom inputs — match what both call sites have), `selectedFrame`, `colorScheme`, `onSelect`, `onDelete`, `deletePolicy`.
- **One deletePolicy: the flat-list rule** (any keyframe deletable; empty list is valid → default centered crop / region defaults). The `>= 1` UI nicety is itself flagged in memory as the bug — confirm with the user-visible behavior desired: per the flat-list model, delete should be shown at ANY count. Implement flat-list-correct and note the change in the PR.
- Both CropLayer and RegionLayer render through it; effective-frame math + `FRAME_TOLERANCE = 1` display logic (duplicated at both sites' L34-74 per the audit) moves in too.

## Context

- Read `.claude/skills/keyframe-data-model` + the EPIC's model facts first.
- RegionLayer also contains a dead `'segment'` mode (audit #14: only caller passes `mode="highlight"`; framing uses its own SegmentLayer). Do NOT unify segment UI here — but if the segment-mode code obstructs the extraction, delete it in a separate prefix commit (grep-proof it's dead first).
- Origins (`'user' | 'trim'`) affect marker rendering — keep origin-based styling identical per mode via colorScheme, not forked logic.

## Steps

1. [ ] Snapshot tests (or RTL render assertions) for CURRENT CropLayer + RegionLayer keyframe rendering: positions, visibility, delete affordance per keyframe-count case.
2. [ ] Extract KeyframeTrack; migrate CropLayer (behavior-identical — snapshots green).
3. [ ] Migrate RegionLayer highlight mode — the delete-gating change is the ONE intended diff; assert it explicitly (1-keyframe highlight track shows delete).
4. [ ] Manual: delete-first-keyframe works in BOTH modes on dev; verify empty-list behavior (centered default) in both.

## Acceptance Criteria

- [ ] One keyframe-track renderer; CropLayer/RegionLayer are thin configs
- [ ] "Can't delete first keyframe" fixed in highlight mode; flat-list rule uniform
- [ ] Only intended rendering diff is the delete gating (snapshot-verified)
- [ ] Empty-keyframe-list behavior verified in both modes
