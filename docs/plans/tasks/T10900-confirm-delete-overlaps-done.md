# T10900: "Confirm Delete" overlaps Cancel/Done in the desktop clip-editor strip

**Status:** STAGING
**Impact:** 5
**Complexity:** 1
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Problem

User screenshot (prod, 2026-09-21): after clicking "Delete play" in the under-canvas editor
strip, the red "Confirm Delete" button wraps to two lines and overlaps "Cancel", which in turn
overlaps "Done".

## Root cause

`AnnotateFullscreenOverlay.jsx` (layout `strip`) wrapped `DeletePlayButton` in a fixed
`w-32` (128px) slot sized for the single "Delete play" button. The confirm state is TWO
`flex-1` buttons ("Confirm Delete" + "Cancel") that cannot fit in 128px, so they overflowed
the slot and were painted over Done.

## Fix

- Slot is `min-w-[8rem] shrink-0` (keeps the resting width, grows for the confirm pair).
- Both confirm buttons get `whitespace-nowrap` so "Confirm Delete" never wraps.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` (~L786-798)
- `src/frontend/src/modes/annotate/components/DeletePlayButton.jsx` (full variant confirm state)

### Related Tasks
- T10610 (DeletePlayButton extraction), T10410 (badges moved off this slot)

## Acceptance Criteria

- [x] Confirm Delete / Cancel / Done sit side by side with no overlap in the desktop strip
- [x] `DeletePlayButton.test.jsx` + `AnnotateFullscreenOverlay.noSaveButton.test.jsx` green
