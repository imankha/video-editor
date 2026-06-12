# T3540: Framing "In Progress" Visually Indistinguishable From Complete

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-06-11
**Updated:** 2026-06-11

## Problem

On the Reel Drafts list, a clip segment in the framing progress strip renders as a
**fully-filled solid blue block** when the clip has ANY framing edit. With a 1-clip
project this paints a full-width blue bar, which reads as "framing complete, go to
overlay" - the only cue distinguishing it from the done state is hue (blue vs green).
Blue is also the app's primary action color, which reinforces the "complete" reading.

**Real instance (prod, imankh@gmail.com, project 21 "Brilliant Interception, Pass and
Dribble"):** the working clip's entire framing state was a single crop keyframe at
frame 0 (one accidental reticule drag, persisted via the surgical `addCropKeyframe`
action). The card showed status "Editing" with a full blue framing bar. The user
expected a framed reel ready for overlay; opening it revealed effectively no framing
work. Status text "Editing" also overstates progress - it implies an active session.

**Why the data can't be smarter:** a single frame-0 keyframe is a *legitimate complete
framing* (static crop). Framing completeness is unknowable from edit data; the only
true "done" signal is the framing export (`has_working_video`). So the fix is visual
language, not a keyframe-count heuristic. Do NOT "fix" this by changing the
`clips_in_progress` SQL.

## Solution

Make in-progress segments look visibly unfinished; reserve solid fill for done.
Frontend-only, no backend changes.

1. **Half-fill treatment for `in_progress` clip segments** in `SegmentedProgressStrip`:
   blue fills the bottom ~50% of the 12px segment over the gray track (alternative:
   solid blue at ~35-40% opacity with a 2px solid blue bottom edge). Done segments
   stay solid green - unchanged. Shape now carries the meaning, not just hue.
2. **Status wording:** card status "Editing" -> "Framing started" (ProjectManager
   status text + the isEditing chip + "Continue where you left off" subtitle if it
   surfaces the same string).
3. **Tooltip:** segment title "Editing" -> "Started - export framing to complete".
4. **Legend:** the group-header "In Progress" legend swatch uses the same half-fill
   treatment so the legend teaches the new shape.

Out of scope (intentionally): "reset framing" affordance for accidental edits;
per-clip granular progress percentage (unknowable, see above); any change to
`clips_in_progress` backend semantics.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` - `SegmentedProgressStrip`
  (~L1561-1728: segment build, `statusColors` map at ~L1634, tooltip at ~L1713),
  status text at ~L2014-2018, `isEditing` derivation at ~L175-188, group-header
  legend (Done / In Progress / Not Started swatches)

### Related Tasks
- T1660 (Export Failure Card State) - prior change to the same strip's states
- T1950 (Rename Reels/Gallery Terminology) - prior wording pass on these cards

### Technical Notes
- Current states in `statusColors`: done (green-500), exporting (amber-500),
  export_failed (orange-500), disconnected (gray-400), in_progress (blue-500),
  ready (blue-300), pending (gray-600). Only `in_progress` *clip* segments change
  treatment; the overlay segment's `in_progress` should get the same treatment for
  consistency (overlay edits without final export are also "started, not done").
- `ready` (blue-300, overlay ready) must remain distinguishable from the new
  in-progress treatment.
- Framing-complete projects collapse per-clip segments into one solid green
  "Framing" segment (~L1572-1582) - that path is untouched.
- Reference: backend `clips_in_progress` counts any clip with non-NULL
  crop_data/segments_data/timing_data and no exported_at
  (`src/backend/app/routers/projects.py` ~L327-331). Leave as-is.

## Implementation

### Steps
1. [ ] Add half-fill rendering for `in_progress` segments in `SegmentedProgressStrip`
2. [ ] Update status wording "Editing" -> "Framing started" (card status, chip,
       continue-card subtitle if shared)
3. [ ] Update segment tooltip text for `in_progress`
4. [ ] Update group-header legend swatch to match
5. [ ] Unit test: in_progress segment renders half-fill treatment; done renders solid
6. [ ] Visual check across states: not started / started / exporting / failed /
       framing done / overlay started / done

### Progress Log

**2026-06-11**: Created from prod investigation (single frame-0 user keyframe made a
project card read as framed). Design plan approved direction: presentation-only fix.

## Acceptance Criteria

- [ ] A project with minimal framing edits no longer renders a fully-filled blue bar
- [ ] Done (green, solid) is visually distinct from started (partial fill) at a glance
      without relying on color alone
- [ ] Card status reads "Framing started" instead of "Editing"
- [ ] Exporting / failed / disconnected / ready states unchanged
- [ ] No backend changes; `clips_in_progress` semantics untouched
- [ ] Frontend unit tests pass
