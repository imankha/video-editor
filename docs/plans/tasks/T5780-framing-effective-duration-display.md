# T5780: Framing shows effective (slow-mo-adjusted) clip length

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-24
**Updated:** 2026-07-24

## Problem

User report 2026-07-24 (our biggest user, via text):

> During framing, I noticed that there is no sort of timer update when you add in slow
> motion for a clip. So I take a 6 second clip and add 3 seconds of slow mo, the cost is
> 9 credits but the clip length still shows as 6 seconds. Obviously that's accounted for
> in the credits but it's a little bit of a guessing game.

The Framing screen displays only the SOURCE duration (`formatTimeSimple(duration || clipDuration)`
in `FramingModeView.jsx:288`). Slow-mo stretches the OUTPUT: a 6s clip with 3s at 0.5x
renders as 9s of output video — and credits are billed per output second (see T5790).
Nothing in the UI reflects the output length, so the user can't predict what they'll get
or what it costs. This is a guessing game exactly where money is involved.

## Solution

Add a live "output length" indicator to the Framing screen that shows the effective
(post-trim, post-speed) duration and updates immediately as the user edits speed
segments, trims, or splits.

- **Per-clip**: show the selected clip's effective duration near the existing duration
  readout (do NOT change the playback timer itself — it correctly shows source-timeline
  position). Suggested form: `Output: 0:09` chip, only visually emphasized when it
  differs from source length (i.e., slow-mo present).
- **Project total (multi-clip)**: show the summed effective duration of all clips
  (e.g., near the clip list / export area). This is the number T5790 turns into credits.

### Prerequisite extraction (mechanical commit, separate)

`calculateEffectiveDuration(clip)` already exists and handles both data formats
(frontend `{segmentSpeeds, boundaries, trimRange}` and DB `{segments:[{start,end,speed}], trim_start/trim_end}`)
— but it lives in `src/frontend/src/containers/ExportButtonContainer.jsx:39` and is
imported from there by `useProjectLoader.js`. Extract it (plus `buildClipMetadata` if
convenient) to `src/frontend/src/utils/effectiveDuration.js` as a pure-move commit,
update imports (`ExportButtonContainer.jsx`, `useProjectLoader.js`,
`ExportButtonContainer.test.js`). No behavior change in that commit.

### Live-state subtlety (the important part)

The saved `clip.segments` is stale while the user is editing: the SELECTED clip's live
speed/trim state lives in the `useSegments` hook (frontend format: `segmentSpeeds`,
`boundaries`, `trimRange`). The indicator must compute from the live hook state for the
selected clip and from saved `segments` for the other clips — otherwise it only updates
after a save and the "no timer update" complaint remains. This is a pure derived
computation at render time: **no new state, no store field, no persistence** (see
no-redundant-state rule; compute via selector/helper).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/containers/ExportButtonContainer.jsx` — current home of `calculateEffectiveDuration` (extract from here)
- `src/frontend/src/utils/effectiveDuration.js` — NEW: extracted pure util + unit tests
- `src/frontend/src/hooks/useProjectLoader.js` — imports `calculateEffectiveDuration` (update import)
- `src/frontend/src/containers/ExportButtonContainer.test.js` — existing tests for the calc (update import)
- `src/frontend/src/modes/FramingModeView.jsx` — duration readout at :288; add output-length indicator
- `src/frontend/src/containers/FramingContainer.jsx` — wire live segment state -> derived effective duration
- `src/frontend/src/modes/framing/hooks/useSegments.js` (or equivalent) — source of live `segmentSpeeds`/`boundaries`/`trimRange`

### Related Tasks
- Blocks: T5790 (credit estimate on Export button — consumes the same extracted util + live total)
- Related: T5090 (slow-mo timeline math for posters — reference for stretched-timeline reasoning)

### Technical Notes
- Speed model: per-segment `speed` (0.5 = slow-mo doubles that segment's output time);
  effective = sum over segments of `(end - start) / speed`, clipped to trimRange.
- Formatting: reuse `formatTimeSimple` from `components/shared/clipConstants`.
- Show sub-minute values as `0:09`; consider one decimal (`9.0s`) only if it doesn't
  clutter — final call at implementation with a quick look at the style guide.
- Mobile: indicator must be visible on 360-428px widths (Framing mobile layout) without
  colliding with the T5360/T5674 control-bar work. Real-browser verify per project rule.

## Implementation

### Steps
1. [ ] Mechanical commit: extract `calculateEffectiveDuration` (+ tests) to `utils/effectiveDuration.js`, update imports
2. [ ] Derive live effective duration for the selected clip from `useSegments` state (frontend format path of the util)
3. [ ] Add per-clip output-length indicator to Framing UI (View-layer only)
4. [ ] Add multi-clip project total (sum of per-clip effective durations, live for selected + saved for rest)
5. [ ] Unit tests: speed-change updates value; trim updates value; no-speed clip equals trimmed source length; multi-clip sum
6. [ ] Real-browser verify (desktop + 390px mobile): edit a speed segment, watch the indicator tick

### Progress Log

**2026-07-24**: Task created from user feedback.

## Acceptance Criteria

- [ ] 6s clip + 3s section at 0.5x speed -> indicator shows 0:09, updating the moment the speed is applied (no save/export needed)
- [ ] Trimming the clip updates the indicator immediately
- [ ] Clip with no speed edits: indicator equals trimmed source length (or is de-emphasized/hidden — final UI call)
- [ ] Multi-clip project shows a correct live total
- [ ] Playback timer behavior unchanged (still source-timeline)
- [ ] No new persisted or store state; derived at render only
- [ ] Unit tests pass; real-browser evidence on desktop + mobile widths
