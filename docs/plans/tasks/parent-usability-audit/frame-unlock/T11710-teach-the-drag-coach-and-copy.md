# T11710: Teach the drag: coach chip, ring and gesture-naming copy

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Tier:** M (frontend only, ~5 files, ~130 LOC including tests)
**Created:** 2026-10-04
**Decision gate:** F1 (recommended option D; this task is the "A" half). Depends on T11700. **Ruled 2026-10-04: recommended option taken.**

## Epic Context

Task 2 of 3 in [Epic A: Frame Highlight unlock](EPIC.md). T11700 added the "Set focus point"
button; reuse its `focusPointCount` prop plumbing. Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

The instructions say "Each spot you set is a focus point" but never say *how* to set one. The timeline
shows no hint at 0 focus points because of a stale rule. The rotate nudge promises "nothing scrolls"
while portrait currently scrolls sideways. Parents need the drag gesture for every focus point after
the first one, which is where framing quality comes from.

## Solution

While the clip has 0 focus points, and only then:

1. **Ring** on the crop box: `ring-2 ring-amber-400/70 animate-pulse motion-reduce:animate-none rounded-sm`.
2. **Coach chip** pinned to the top center of the video (not to the box, which is ~70px wide at 390):
   `absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-400/60 bg-gray-900/90 px-3 py-1 text-xs font-medium text-amber-100 shadow-lg`,
   `Move` icon size 14, copy **Drag the box onto your player**. Hidden while dragging and while the
   video plays.
3. Both disappear when the first focus point exists. They are derived from `focusPointCount === 0`:
   no state, nothing persisted.

### Copy (all into `config/displayNames.js`; no em dashes)

| Where | New text |
|-------|----------|
| Instructions header (`FramingInstructions.jsx`) | Frame your player |
| Headline (`STAGE_REASONS.FRAMING`) | unchanged |
| Steps paragraph | Drag the box onto your player. Letting go sets a focus point at that moment in the video. If your player is already inside the box, tap Set focus point. |
| Second paragraph | Play the video and drag the box again whenever your player moves out of it. Your highlight moves smoothly between the focus points you set. |
| Third paragraph | Use Trim and slo-mo to slow down the key moment. |
| Preview prompt | Press play to preview your framing before you generate. |
| Disabled Generate caption (desktop + stacked mobile) | Move the box onto your player, then tap Set focus point |
| Empty timeline hint (`CropLayer`) | No focus points yet. Drag the box on the video to add one. |
| Rotate nudge title (`FOCUS_HINTS.ROTATE_TITLE`) | Optional: rotate your phone for a larger video |
| Rotate nudge subtitle (`FOCUS_HINTS.ROTATE_SUBTITLE`) | Everything here also works upright |

The current preview line "follows your athlete" edges toward a tracking claim; it is replaced above.

## Relevant Files (under `src/frontend/src/`)

- `modes/focus/FramingInstructions.jsx:59-87` - inline JSX copy; move it to `displayNames.js`.
- `components/ExportButtonView.jsx:150-158` - hardcoded disabled caption (`data-testid="export-unframed-caption"`).
- `modes/focus/layers/CropLayer.jsx:79-124` - `handleTrackClick` and the stale `visibleKeyframes.length === 2` hint.
- `modes/focus/RotateNudge.jsx:52-57` and `config/displayNames.js:554-555` (`FOCUS_HINTS`).
- The crop overlay component rendered by the Focus stage (find it from `FocusModeView.jsx`; it is
  the component that fires `onCropComplete`).

## Implementation Steps

1. Add the strings above to `displayNames.js` (`FOCUS_HINTS.GENERATE_LOCKED`, `FOCUS_HINTS.COACH_DRAG`,
   `FOCUS_HINTS.TIMELINE_EMPTY`, a `FRAMING_INSTRUCTIONS` group). Replace the inline JSX and the
   hardcoded caption with these keys.
2. Pass `focusPointCount` (already computed for T11700) and `isDragging` / `isPlaying` to the crop
   overlay. Render the ring class and the chip when `focusPointCount === 0 && !isDragging && !isPlaying`.
3. In `CropLayer.jsx` change the hint condition to `visibleKeyframes.length === 0` and use the new
   copy. Leave `handleTrackClick` behavior unchanged.
4. Update the rotate nudge strings. **Merge order:** the subtitle is only true once T11740 removes the
   portrait horizontal overflow. If T11740 has not merged, keep the old subtitle and leave a TODO in
   the PR description, not in code.

## Acceptance Criteria

1. Fresh clip at 1440 and 390: ring and chip visible; after the first focus point (button or drag)
   both disappear without a reload.
2. With `prefers-reduced-motion: reduce` the ring does not pulse.
3. The instruction panel names the drag gesture and the Set focus point button.
4. The empty timeline shows "No focus points yet. Drag the box on the video to add one." at 0 points
   and nothing at 1+.
5. No string in the diff contains an em dash, "Saved", "track", "follow", "automatic" or "center"
   as a claim about the app.

## Tests (red first)

- Update `components/ExportButtonView.test.jsx` (lines ~86, ~120 assert the old caption).
- Update `modes/focus/FramingInstructions.test.jsx`, `modes/focus/__tests__/RotateNudge.test.jsx`
  (keep its "render alone writes nothing" cases intact), `CropLayer.test.jsx:100`.
- New test: chip and ring render at 0 points, hidden when `isDragging`, hidden at 1 point.
- E2E: `e2e/T8510-export-guard.qa.spec.js:56` uses a regex on the caption; update it and run locally.

## Landmines

- The chip must be `pointer-events-none` so it never blocks a drag on the box.
- Do not compute "has the user seen the chip" into localStorage. It disappears because the data
  changed, not because of a dismissal.
- Copy accuracy rule (README). "Smoothly between the focus points you set" is the only allowed motion claim.
