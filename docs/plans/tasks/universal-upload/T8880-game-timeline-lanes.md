# T8880: Game timeline v2: lanes, backbone, extensions

**Status:** STAGING
**Impact:** 7
**Complexity:** 6
**Created:** 2026-09-05
**Updated:** 2026-09-06

## Problem

The Annotate timeline maps game time by concatenating videos in sequence order
(`buildFullVideoTimeline`). With offsets (T8870), overlapping videos need: lane
assignment (minimal layers), a backbone timeline that stays byte-identical to today when
nothing overlaps, and "coverage extension" stretches where only an angle has footage.
Pure logic + tests in this task; rendering is T8890.

## Solution

A new `buildGameTimeline(gameVideos)` in `useVirtualTimeline.js` returning the lane
model, leaving `buildFullVideoTimeline` and every existing export UNTOUCHED (angle-free
games must hit the identical old code path). See [EPIC.md](EPIC.md) decisions 7 and 9.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` - add `buildGameTimeline`
  (existing `buildFullVideoTimeline` ~L136-217 stays as-is)
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.test.js` - extend (existing
  boundary expectations ~L489-508 must keep passing untouched)
- `src/frontend/src/containers/AnnotateContainer.jsx` - ~L247-250 builds the timeline;
  switch to `buildGameTimeline` ONLY when any video has an offset that disagrees with its
  prefix-sum (i.e. real overlap/gap placement exists); else keep the old call

### Related Tasks
- Depends on: T8870 (`offset_seconds`, `recorded_at` in the load payload)
- Blocks: T8890, T8900
- Read `.claude/knowledge/annotate.md` and `keyframes-framing.md` notes on virtual time
  BEFORE starting; the known seek-gap landmine (annotate.md L34-39: clip editor seeds
  file-relative time into a virtual-time controller) must not be widened by this task.

### Technical Notes
- Input: array of `{sequence, duration, offset_seconds, recorded_at, url, ...}`.
  Interval of video v = `[offset, offset + duration)`. A null offset (pre-migration edge)
  falls back to prefix-sum by sequence (same rule as T8870's backfill).
- Lane assignment (document the algorithm in a comment): sort by offset ascending
  (ties: sequence); for each video pick the LOWEST lane whose last interval ends <= this
  start (+`OVERLAP_EPSILON_S = 1.0` tolerance so 1-2s recording-split slop does not
  create phantom lanes). Greedy on sorted intervals is provably minimal - state this in
  the comment so nobody "improves" it.
- Backbone = lane 0 videos in order. Domain construction mirrors
  `buildFullVideoTimeline`: virtual time concatenates lane-0 videos (real gaps between
  them compress to boundary markers, exactly today's behavior).
- Coverage extensions (EPIC decision 9): compute the union of lane-1+ intervals; any part
  NOT covered by lane-0 intervals becomes an extension segment. Insert extensions into
  the virtual domain at their wall-clock position: after the lane-0 video they follow
  (or before the first, for negative offsets). Each extension contributes its real length
  to virtual time and records `{type: 'extension', sourceSequence, wallStart, wallEnd}`.
- Return shape:
  `{ domain: [{type: 'video'|'extension', sequence?, virtualStart, virtualEnd, wallStart}],
     lanes: [[{sequence, virtualStart, virtualEnd}]],   // index 0 = backbone
     angles: [{sequence, lane, virtualStart, virtualEnd, name}],  // lanes 1+ flattened
     virtualToWall(t), wallToVirtual(w),
     virtualToSource(t, activeSequence) -> {sequence, fileTime},
     sourcesAt(t) -> [sequence...],   // every video covering virtual t
     clampToSource(t, sequence),
     totalDuration }`
  Angle virtual positions map through wall-clock: an angle overlapping backbone footage
  maps inside that footage; an angle over a compressed backbone GAP maps onto the
  boundary point unless an extension exists there.
- `sourcesAt` is what T8890's badge and auto-fallback consume; `virtualToSource` is what
  playback uses (active source -> which file + file-relative time).
- Angle display name (used by T8890/T8910 but computed here): filename stem truncated to
  14 chars middle-ellipsis; fallback "Extra clip {n}" by lane order. Backbone name:
  "Main camera".

## Implementation

### Steps
1. [ ] Implement `buildGameTimeline` + helpers as pure functions (no React state).
2. [ ] Unit tests, ALL synthetic descriptors:
   - No overlap, offsets == prefix sums -> domain/boundaries EXACTLY equal to
     `buildFullVideoTimeline`'s output for the same input (equivalence test - the
     acceptance bar).
   - EPIC scenario: 1 backbone + 4 clips, 2 overlapping each other -> lanes = 3 exactly;
     the third lane's only occupant is the later of the overlapping pair.
   - Halftime-gap clip (offset inside a backbone gap, no overlap) -> lands on lane 0
     between the halves, boundary markers both sides.
   - Angle past backbone end -> extension appended; angle before backbone start
     (negative offset) -> extension prepended.
   - Two phone clips, no main camera, partial overlap -> earlier = lane 0, later = lane 1,
     outlasting tail = extension; whole span playable.
   - 1-second recording-split slop does NOT create a second lane (epsilon test).
   - `sourcesAt` returns 3 sequences inside the deep overlap, 1 outside.
3. [ ] Wire `AnnotateContainer` selection logic (old path when placement is pure
   prefix-sum; new path otherwise) with a test asserting the old path is chosen for a
   plain 2-half game.

### Progress Log

**2026-09-05**: Filed.

**2026-09-06**: Implemented by an automated worker. Escalated to the expert agent mid-task
for the backbone-anchoring algorithm in the prepend/negative-offset edge case (resolved:
backbone = longest-video spine grown by concatenation, then pre-seeded minimal-greedy lane
assignment for lanes >= 1). Reviewer caught a MAJOR issue before approval: the builder
selector would have routed gapped-but-non-overlapping multi-segment games to the new lane
builder, which wasn't designed for that case - fixed to select on REAL overlap only.
Test-first (33 new tests, RED->GREEN), 128 related tests green, CI green. Merged via PR
#355 (merge commit 83a647cf).

## Acceptance Criteria

- [ ] Equivalence test: angle-free games produce identical timelines via either builder
- [ ] EPIC scenario yields exactly 3 lanes with the specified occupancy
- [ ] All existing `useVirtualTimeline.test.js` expectations pass UNMODIFIED
- [ ] No rendering/DOM changes in this task
- [ ] Curated frontend unit set green
