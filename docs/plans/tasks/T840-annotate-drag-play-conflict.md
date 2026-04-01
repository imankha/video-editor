# T840: Annotate Mode — Playback Fights With Start/End Time Drag

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-01
**Updated:** 2026-04-01

## Problem

In annotation mode, when the video is playing and the user drags the start or end time handle (clip boundary lever), the playback continues and fights with the drag preview. The video jumps between the playback position and the drag position, creating a stuttering/fighting effect.

### Expected Behavior
Dragging a start or end time handle should immediately pause playback so the user can precisely position the boundary. Playback can optionally resume when the drag ends.

### Actual Behavior
Playback continues during drag, causing the video to rapidly alternate between the playback position and the drag-preview position.

## Solution

In the drag start handler for clip boundary levers, call `pause()` on the video before processing the drag. This is a simple fix — just add a pause call at the beginning of the `onDragStart` or `onMouseDown` handler for the start/end time handles.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/` — clip region boundary drag handlers
- `src/frontend/src/hooks/useVideo.js` — play/pause control

### Related Tasks
- None
