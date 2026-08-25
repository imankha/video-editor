# T7720: Clicking the timeline thumbnail marker should open Thumbnail settings and seek to it

**Status:** STAGING
**Priority:** P2 (UX affordance gap, user-directed 2026-08-25)
**Impact:** 4
**Complexity:** 2
**Created:** 2026-08-25
**Updated:** 2026-08-25

## Problem

`PosterMarkerLayer.jsx` renders the thumbnail marker (a cyan chip) on the Overlay screen's
timeline, in the video track's top band. Today it only responds to **drag** (and arrow-key
nudge) — a plain click (pointerdown+up with no movement past the drag threshold) does
nothing at all. This was deliberate for the DRAG behavior (a prior bug, T6560, made a bare
click relocate the frame — fixed by requiring real pointer movement to commit a change), but
it left clicking the marker with no effect whatsoever, when a user would reasonably expect
clicking it to take them to the thumbnail settings.

## Solution

A click (not a drag) on the thumbnail marker should:
1. Switch the Overlay settings section to the **Thumbnail** tab
2. Move the timeline playhead to the marker's current time (the frame it already represents
   — NOT the click position; this is different from the old buggy click-to-relocate
   behavior, which stays fixed/removed)

`activeTab` is local `useState` inside `OverlayModeView.jsx` (confirmed:
`const [activeTab, setActiveTab] = useState('overlay')`, ~line 283) — the click handler
needs to be threaded down from there, through `OverlayMode.jsx`, to `PosterMarkerLayer.jsx`,
reusing `OverlayModeView.jsx`'s own `setActiveTab` and `seek`. This does NOT touch
`OverlaySettingsTabs.jsx` (confirmed file-disjoint from T7710).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/layers/PosterMarkerLayer.jsx` — `handlePointerUp` already
  distinguishes a real drag (`moved === true`) from a click-in-place (`moved === false`, ~line
  205-214: `if (moved) commitDrag(finalTime);` — currently a non-moved release does nothing at
  all). Add a new callback prop (e.g. `onClick`) invoked in the `!moved` branch, passing the
  marker's current `visualTime`. Do not change the drag-commit behavior.
- `src/frontend/src/modes/overlay/OverlayMode.jsx` — already threads `onPosterMarkerDragEnd`
  and `isThumbnailTabActive` down to `PosterMarkerLayer` (~line 98-102, 352+) — add the new
  click callback prop through the same path.
- `src/frontend/src/modes/OverlayModeView.jsx` — owns `activeTab`/`setActiveTab` (~line 283)
  and has `seek` available (already used elsewhere in this file, e.g.
  `handleSelectRegion`/`handleSelectElement` seek into a text region on selection — follow
  that existing pattern). Define the new handler here: sets `activeTab` to `'thumbnail'` and
  calls `seek` with the marker's time, pass it down to `<OverlayMode>`.
- Test files for all three: `PosterMarkerLayer.test.jsx` (if it exists, else create),
  `OverlayMode` test coverage, `OverlayModeView` test coverage

### Related Tasks
- File-disjoint from T7700 (Framing→Focus rename) and T7710 (Overlay tab label) — all three
  spawned together 2026-08-25, verified not to share files

### Technical Notes
- Reuse the SAME playhead-seek pattern already used for text-region selection in
  `OverlayModeView.jsx` (`handleSelectRegion`/`handleSelectElement`) rather than inventing a
  new seek mechanism — this codebase already has the "click a timeline element → seek + open
  its settings tab" pattern established for text regions; the thumbnail marker should follow
  the same shape for consistency.
- Do not touch the drag-commit logic (`commitDrag`, `handlePointerDown`, the
  `pointermove`/`pointerup`/`pointercancel` drag-tracking effect) — this task adds a new,
  separate `!moved` branch, it does not modify the existing moved/drag path.

## Implementation

### Steps
1. [ ] Add `onClick` callback prop to `PosterMarkerLayer.jsx`, invoked in the `!moved` branch
       of `handlePointerUp` with the marker's current `visualTime`
2. [ ] Thread the prop through `OverlayMode.jsx`
3. [ ] Define the handler in `OverlayModeView.jsx` (sets `activeTab('thumbnail')` + `seek`),
       following the existing text-region-selection seek pattern
4. [ ] Tests: click (no movement) opens the Thumbnail tab and seeks to the marker's time; drag
       behavior is unchanged (regression); a genuine drag still does NOT also fire the click
       behavior

## Acceptance Criteria

- [ ] Clicking the thumbnail marker (without dragging) switches to the Thumbnail settings tab
- [ ] The same click moves the timeline playhead to the marker's time
- [ ] Dragging the marker still only commits on a real drag (T6560's fix is unchanged) and
      does NOT also trigger the click behavior
- [ ] Tests pass; CI green
