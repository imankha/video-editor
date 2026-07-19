# T5540: Annotate Camera Toggle

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Created:** 2026-07-19
**Updated:** 2026-07-19

## Problem

The payoff task: while annotating, far-side action is unwatchable on your own camera but
was probably filmed well by the other parent's camera. The user needs a one-keystroke
toggle to the other camera **at the same game moment**, and back. Both cameras' videos are
already in local `game_videos` (T5520, `camera` column) with confirmed `wall_offset`s
(T5530). Time model + UX are settled in [EPIC.md](EPIC.md) decisions 4-5 and UX flow 5.

## Solution

1. **Per-camera virtual timelines.** `buildFullVideoTimeline(gameVideos)` currently
   concatenates ALL videos; it must build one timeline per camera:
   `buildFullVideoTimeline(gameVideos.filter(v => v.camera === activeCamera))`. The active
   camera lives in Annotate state (`useAnnotateState` — session-only, NEVER persisted:
   no-persisted-view-state rule). Primary camera = own member slot (or the only camera
   present); T5520's temporary primary-filter in `applyGameData` is removed here.
2. **Cross-camera time mapping** (pure functions, new module
   `src/frontend/src/modes/annotate/utils/cameraTimeMap.js`):
   - `toShared(virtualT, cameraTimeline, offsets)` → shared-clock seconds
   - `fromShared(sharedT, cameraTimeline, offsets)` → `{virtualT} | {gap: true, nearest}`
   - `mapAcross(virtualT, fromCam, toCam)` composed from the two.
   Exhaustive unit tests: multi-video halves, differing start times, one camera rolling
   through halftime, out-of-coverage before/after, NULL offsets (→ mapping unavailable).
3. **Toggle UI.** Flip-camera button in the Annotate player controls + `C` keyboard
   shortcut. On toggle: compute mapped virtual time for the other camera, swap the video
   source set (same mechanism as the existing multi-video source switching), seek, resume
   prior play/pause state. Coverage gap at current playhead → button disabled with
   tooltip ("{Name}'s camera doesn't cover this moment"). Offsets NULL (not yet aligned)
   → button shows the "Sync cameras" affordance (routes to T5530's modal) instead of
   toggling blind.
4. **Annotations are camera-agnostic in v1.** Clip regions remain keyed to the PRIMARY
   camera's virtual timeline. While viewing the secondary camera, the timeline/clip strip
   continues to render in primary time (the playhead position is mapped for display);
   creating/editing clips while on the secondary camera stores primary-time values via
   `mapAcross`. If the mapped moment falls in a primary-camera coverage gap, block clip
   creation with a toast (edge case; do not invent extrapolated times). Extraction from
   the secondary camera's pixels is T5550 — in this task exported clips still cut from
   primary sources exactly as today.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` — `buildFullVideoTimeline` (L136-217) per-camera
- NEW `src/frontend/src/modes/annotate/utils/cameraTimeMap.js` + unit tests
- `src/frontend/src/modes/annotate/hooks/useAnnotateState.js` — `activeCamera` session state
- `src/frontend/src/containers/AnnotateContainer.jsx` — `applyGameData` (remove T5520 filter, thread camera), source-swap + seek handler
- `src/frontend/src/screens/AnnotateScreen.jsx` — toggle button + `C` shortcut wiring
- `src/frontend/src/stores/gamesDataStore.js` — member display names for tooltip
- `src/frontend/e2e/` — NEW toggle spec

### Related Tasks
- Depends on: T5520 (camera rows local), T5530 (offsets)
- Blocks: T5550, T5560
- Related: T4060 landmine (never gate load paths on "some video src exists"); T3960 select-on-load timing

### Technical Notes
- Knowledge docs: [annotate.md](../../../.claude/knowledge/annotate.md) — READ the landmines section; the virtual-timeline and load-order code is timing-sensitive.
- **Keep the mapping pure and the toggle dumb**: all camera math in `cameraTimeMap.js`
  (unit-tested exhaustively), the toggle handler just calls it. No reactive effects — the
  toggle is a gesture; source swap + seek happen in its handler.
- `C` shortcut must not fire while typing in clip fields (follow the existing keyboard
  handler's focus guards).
- Playhead persistence (`saveLastPlayhead`, resume) stays in PRIMARY camera time — map
  before saving if the user is on the secondary camera when tab-hide fires.
- **Real-browser verification required** (source swap + seek is exactly the class jsdom
  lies about). Verify: toggle mid-play resumes playing at the same moment; toggle near a
  coverage edge; toggle with keyboard while a clip is selected.
- M/L-tier judgment: no schema change, but timing-sensitive core screen → include
  Reviewer; Architect optional (design is settled here + EPIC).

## Implementation

### Steps
1. [ ] `cameraTimeMap.js` + exhaustive unit tests (write these FIRST — they pin the time model)
2. [ ] Per-camera `buildFullVideoTimeline` + `activeCamera` state; remove T5520 primary filter
3. [ ] Toggle button + shortcut + source-swap/seek handler + gap/unaligned states
4. [ ] Clip create/edit mapping while on secondary camera (+ gap toast)
5. [ ] Playhead save/resume mapping
6. [ ] E2E + real-browser verification session

## Acceptance Criteria

- [ ] `C` / button toggles cameras with the playhead staying on the same game moment (verified visually in a real browser against a synced pair)
- [ ] Coverage gaps disable the toggle with an explanatory tooltip; unaligned games route to Sync instead
- [ ] Clips created while viewing the secondary camera land at the correct primary-time position; export output is byte-identical behavior to today
- [ ] Playhead resume works regardless of which camera was active at exit
- [ ] `cameraTimeMap` unit tests cover halves, offsets, gaps, NULL offsets; all tests pass
- [ ] Active camera is session state only — nothing persisted
