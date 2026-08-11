# T6880: Overlay text renders with the playhead OUTSIDE the region's range (selected-region exception)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-11
**Updated:** 2026-08-11

## Problem

User report (2026-08-11, top-area bug, with screenshot): the playhead sits past a text
region's end handle on the timeline, yet the preview canvas still renders that region's
text ("blah blah"). Meanwhile the Text side panel correctly says "No text region under the
playhead" — the panel and the canvas disagree about the same playhead position.

## Root mechanism (already located — this is a design decision to unwind, not a hunt)

`TextOverlayPreview.jsx` renders a region when its half-open `[startTime, endTime)` window
contains `currentTime` **PLUS whenever it is the SELECTED region** — an explicit exception,
documented in the component header ("so editing is visible even while the playhead sits
outside the range"), implemented in the `activeRegions` filter (~159-163). In the
screenshot the region is selected (cyan border + handles + delete affordance on the rail),
so its text renders past its end.

Consequences beyond the reported confusion:

- **Preview lies about export.** `text_render.py` burns in strict windows; the same file
  claims "preview == export by construction" — the exception breaks exactly that for a
  selected region.
- **Playback is wrong too:** if a region stays selected while the user presses play, its
  text renders across the whole clip during preview playback.
- **Panel/canvas contradiction:** the under-playhead panel logic uses strict containment,
  so the two surfaces disagree whenever the exception fires.

## Fix direction (product call embedded — smallest honest option first)

The exception exists so a user editing a region isn't staring at an empty canvas. Options,
roughly in order of preference — confirm with the user only if the first proves wrong in
practice:

1. **Keep the exception but make it honest and narrow:** render the out-of-range selected
   region ONLY while the Text tab is active AND playback is paused, and visually mark it as
   an editing ghost (e.g. reduced opacity), so it can't be mistaken for real output and
   never appears during playback. Panel copy then matches ("showing selected region for
   editing").
2. **Drop the exception; move the playhead instead:** selecting a region snaps the playhead
   into the region (e.g. its start) so the text is visible *legitimately* — strict
   containment everywhere, preview == export unconditionally. (Check T6630's region-tree
   scoping: selection may already imply playhead proximity in most flows.)
3. Drop the exception with no compensation — simplest, but recreates the empty-canvas
   editing problem the exception was built for.

Whatever lands: playback must NEVER show out-of-range text, and the panel and canvas must
agree by construction (one shared "active under playhead" predicate; the editing exception,
if kept, layered explicitly on top).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/overlays/TextOverlayPreview.jsx` — header contract
  (~14-19), `activeRegions` filter (~159-163)
- `src/frontend/src/modes/overlay/OverlayMode.jsx` — Text tab / region selection state,
  under-playhead panel logic (the strict-containment side of the disagreement)
- Text rail component (region selection lifecycle — when selection is set/cleared; T6630's
  expand/collapse region tree)
- Tests: TextOverlayPreview tests pinning the render-gate semantics; add cases for
  selected-but-out-of-range x paused/playing x Text-tab-active/inactive

### Related Tasks
- T5225 (text layer origin), T6630 (region tree + multi-element regions — the "core
  round-4 fix" reshaped this exact filter), T6720 (spatial drag on these rendered
  elements — its grab-frame UX assumes the element is visible when selected; option 2
  interacts with it, option 1 must keep the ghost draggable or deselect on playhead-out)
- T5140 (tutorial reshoot) — Overlay quest shows this screen; another opens-wrong-visual
  to land before reshooting

### Technical Notes
- Real-browser verification (standing rule for this surface; jsdom stubs are already known
  to mislead here — T5380, T6730).
- The half-open `[start, end)` convention and the panel's predicate should end up shared
  (one exported helper), not re-implemented per surface — that's how they diverged.

## Implementation

### Steps
1. [ ] Decide the exception's fate (default: option 1; involve the user if evidence
       favors option 2)
2. [ ] Implement; unify the containment predicate shared by panel + canvas
3. [ ] Tests: out-of-range selected region — hidden during playback, ghost (or hidden)
       when paused per the chosen option; panel/canvas agreement pinned
4. [ ] Live-browser verify against the screenshot's exact setup (region selected, playhead
       dragged past its end)
5. [ ] Lint + relevant test set green

### Progress Log

**2026-08-11**: Filed from user report + screenshot; mechanism located at
TextOverlayPreview's selected-region exception before filing.

## Acceptance Criteria

- [ ] With playhead outside every region and nothing selected: no text on canvas
- [ ] With an out-of-range region selected: playback never shows its text; paused-state
      behavior per the chosen option, visually distinct from real output if shown
- [ ] Text panel and canvas never disagree about "under the playhead"
- [ ] Export unchanged (burn-in windows were always strict)
- [ ] Tests pass
