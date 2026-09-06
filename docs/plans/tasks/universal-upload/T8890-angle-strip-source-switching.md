# T8890: Angle strip UI + source switching

**Status:** WAITING ON USER
**Impact:** 8
**Complexity:** 7
**Created:** 2026-09-05
**Updated:** 2026-09-06

## Problem

Render T8880's lane model in Annotate: violet angle bars above the video track (only
where angles exist), an unambiguous way to choose which camera you are watching, playback
that switches sources and falls back automatically, and clips that visibly belong to
their source. This is the largest UI task of the epic - the full visual spec with
wireframes lives in artifact section 08 (link in [EPIC.md](EPIC.md), decisions 8-10).

## Solution

New components `AngleLanes`, `AngleSwitcherBadge`; modifications to `AnnotateTimeline`,
the clip region layer, and the clips sidebar; active-source state in the existing
annotate state hooks (ephemeral, never persisted).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` - angle strip mount, computed
  `totalLayerHeight`, "Angles" label cell, hatched extension rendering, violet top border
  on non-main lane-0 segments
- `src/frontend/src/modes/annotate/AngleLanes.jsx` - NEW: bars, per-lane rows, tiny-bar
  degradation, mobile merged strip
- `src/frontend/src/modes/annotate/AngleSwitcherBadge.jsx` - NEW: floating over-video pill
- `src/frontend/src/modes/annotate/layers/ClipRegionLayer.jsx` - angle-sourced region
  treatment (violet top border + camera glyph when width >= 28px)
- `src/frontend/src/hooks/useVideoProxy.js` - source switching: the A/B two-slot player
  must be able to load an angle's URL into the idle slot and swap (study the existing
  boundary-swap mechanism ~L17-97 first; switching angles is the same swap with a
  different target)
- `src/frontend/src/containers/AnnotateContainer.jsx` + the annotate state hooks
  (`useAnnotateState`) - `activeSourceSequence` state, default backbone
- Clips sidebar item component (`ClipListItem`) - source pill
- `src/frontend/src/screens/AnnotateScreen.jsx` - virtual clip regions (~L346-370) must
  map angle-sourced clips through `buildGameTimeline` instead of `getVideoOffset`

### Related Tasks
- Depends on: T8870 (data), T8880 (`lanes`, `angles`, `sourcesAt`, `virtualToSource`,
  `clampToSource`, extensions, names)
- Blocks: T8900 (reuses bar rendering + active-source state)
- Clip SAVE path already records `video_sequence` per clip - creating a clip while an
  angle is active must save that angle's sequence (find the save call in
  `AnnotateContainer` ~L1037 and thread `activeSourceSequence` through).

### Technical Notes (condensed spec - artifact section 08 is the authority)
- Angle bars: `h-5` rows above the video track, violet family (`bg-gray-700
  border-violet-500/40 text-violet-300`; active `bg-violet-600 text-white ring-1
  ring-inset ring-violet-300`), camera icon + truncated name, `min-w-[16px]`, icon-only
  below ~40px, 44px coarse-pointer hit boxes, positioned with the same EDGE_PADDING
  formula as every other layer (bare % drifts). Max 3 angle rows; 4+ concurrent collapses
  into a `+N` pill reachable via the badge popover. Zero angles = zero pixels (render
  nothing, not an empty row).
- Strip rows exist per LANE from T8880; a lane row spans only where its bars are.
- Mobile (`useIsMobile`): ONE merged `h-3.5` strip, icon-only pills; overlapping pills
  split the strip height for that span. Adds height only when angles exist.
- Extension segments on the main track: diagonal-stripe hatch
  (`repeating-linear-gradient`, gray-700 on gray-800), tooltip "Only your sideline clip
  covers this part"; inside an extension the ONLY available source is auto-active.
- Switching rules: click an angle bar -> seek to click x AND make it active; click main
  track -> seek AND revert to backbone; outside overlap the backbone is always active.
- `AngleSwitcherBadge`: bottom-right over the video, rendered ONLY when
  `sourcesAt(playhead).length >= 2`, at rest (never hover-only). 2 sources = segmented
  pill (Main camera | {angle}); 3+ = active name + chevron popover. Auto-fallback when
  the playhead exits the active angle's span: silently revert + show "Back to main
  camera" label for 1.5s. Copy per the artifact microcopy table ("2 angles",
  "Watching: {name}").
- Clip creation binding: while active source != backbone, the Add/Edit Play strip header
  appends a violet chip "from {angle}" + the strip microcopy "This play will be cut from
  {angle}." Clip regions save/render with the angle's sequence; out-point clamps via
  `clampToSource`.
- Clip regions + sidebar: angle-sourced region gets `border-t-2 border-violet-400` +
  small camera glyph; sidebar item gets a violet pill `[cam] {angle}`; backbone clips get
  NOTHING (common case stays clean). Editing an angle clip auto-activates its source
  while the editor is open.
- Active source is VIEW STATE: lives in the annotate state hook, resets on game load,
  never persisted, never in a useEffect that writes anywhere (project persistence rules).

## Implementation

### Steps
1. [ ] Extend `useVideoProxy` with `switchSource(sequence, fileTime)` using the existing
   idle-slot swap; verify against a real 2-video game before building UI on top.
2. [ ] Add `activeSourceSequence` to the annotate state (+ derive
   `activeSourceName`/`sourcesAtPlayhead` from T8880's model each frame).
3. [ ] Build `AngleLanes` + timeline integration (computed heights, label cell,
   extensions, violet border on non-main backbone segments).
4. [ ] Build `AngleSwitcherBadge` + auto-fallback + transient label.
5. [ ] Clip binding: save path carries active sequence; regions + sidebar + editor strip
   treatments; clamp on create/edit.
6. [ ] Mobile merged strip + 360-428px pass.
7. [ ] Tests: component tests for bar rendering from the EPIC 3-lane scenario (3 rows at
   the deep overlap, zero rows for an angle-free game - assert NOTHING renders);
   badge appears only in overlap; switching updates active state; clip saved from an
   active angle carries its sequence; auto-fallback fires on exit. E2E: drive a
   real 2-source game (dev backend seed) - switch angle, create clip, verify sidebar
   pill + correct playback source. Real-browser check for the swap smoothness
   (jsdom cannot prove playback).

### Progress Log

**2026-09-05**: Filed.

**2026-09-06**: Implemented by an automated worker (largest UI task in the epic).
Reviewer (fresh-context Opus) caught a real MAJOR bug before approval:
`currentVideoIndexRef` went stale after `switchSource`/auto-fallback crossed a
backbone boundary - fixed + regression test. Branch CI first came back red on the
ESLint regression gate (both new files had an unused `React` import); two-line fix,
verified. 122 unit/component tests + 2 real-browser e2e green, CI green. **Handed
off via PR #356 rather than auto-merged**: the worker's own AC mapping honestly
flags AC3 (clip-on-angle plays from the angle in the editor loop) and AC4
(auto-fallback never leaves a black player) as only provable at the data-layer
pre-staging - a real 2-source overlapping game doesn't exist as a product path yet
until T8900/T8910 ship, and the container has no R2/backend to seed one. Needs
staging verification once a real overlap game can be created.

## Acceptance Criteria

- [ ] Angle-free game renders BYTE-IDENTICAL timeline DOM (snapshot/equivalence test)
- [ ] EPIC scenario: 3 lanes visible at the deep overlap only; clicking each bar switches
      picture within ~1s (idle-slot preload)
- [ ] A clip created on an angle plays from the angle in the editor loop and carries the
      pill in the sidebar
- [ ] Auto-fallback never errors, never leaves a black player
- [ ] Curated test set + new e2e green; live QA on a real seeded game recorded
