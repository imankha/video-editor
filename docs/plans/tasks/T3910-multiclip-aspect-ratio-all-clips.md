# T3910: Multi-Clip Aspect Ratio Applies to All Clips

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-06-23
**Updated:** 2026-06-23

## Problem

In the Framing control, the aspect ratio selector applies to the current clip only. For a
multi-clip reel this means the user must set the aspect ratio on every clip individually,
which is tedious and error-prone — a reel with mixed aspect ratios across clips is almost
never what the user wants. Changing the aspect ratio should apply across **all clips** in
the reel at once for multi-clip projects.

## Solution

Make the Framing aspect-ratio change a reel-level (project-wide) gesture for multi-clip
projects: when the user picks an aspect ratio, apply it to every clip in the project, not
just the active one. Preserve existing per-clip crop keyframes as much as possible
(re-fit/normalize crop boxes to the new ratio rather than discarding framing work).

Open question to resolve during architecture: is aspect ratio conceptually per-clip or
per-reel? If it should simply be per-reel, the cleaner fix is to lift it to project scope
and drop the per-clip storage. Decide before implementing.

## Context

### Relevant Files (REQUIRED — confirm during Code Expert pass)
- `src/frontend/src/components/framing/**` — Framing control / aspect ratio selector
- `src/frontend/src/hooks/useFraming*` or framing container — where ratio is read/applied
- Crop keyframe model — `src/frontend/.claude/skills/keyframe-data-model` (frame-based, origin-tracked)
- Backend surgical persistence for framing gestures (apply ratio change per clip via
  surgical action, NOT a full-state write)

### Related Tasks
- Related: T3700 / T3780 (Framing clarity), T3170 (bug context already captures framing aspect ratio)

### Technical Notes
- **Gesture-based persistence:** the ratio change is a single user gesture; it must fire a
  surgical backend call per affected clip (or one batched reel-level action), never a
  reactive write-back.
- Re-fitting crop boxes to a new ratio must not corrupt keyframe origins (see T350/T2000
  keyframe-origin history).
- Confirm behavior for single-clip projects is unchanged.

## Implementation

### Steps
1. [ ] Code Expert: trace how aspect ratio is stored and applied today (per-clip vs reel)
2. [ ] Architect: decide per-clip vs per-reel model; design crop re-fit on ratio change
3. [ ] Implement: apply ratio to all clips on change for multi-clip projects
4. [ ] Persist via surgical gesture action(s)
5. [ ] Tests: multi-clip ratio propagation + crop re-fit + single-clip unchanged

## Acceptance Criteria

- [ ] Changing aspect ratio in Framing on a multi-clip reel updates all clips
- [ ] Existing crop framing is re-fit (not discarded) where possible
- [ ] Single-clip behavior unchanged
- [ ] Persistence is gesture-based and surgical (no reactive write-back)
- [ ] Tests pass
