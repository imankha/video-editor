# T850: Annotate Mode — Duplicate Scrub UI During Clip Playback

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-04-01
**Updated:** 2026-04-01

## Problem

In annotation mode, when playing back a clip, there appear to be two instances of the scrub/timeline UI for the video. This may be a rendering issue where both the global game timeline scrubber and a clip-scoped scrubber are visible simultaneously, or a duplicate component mount.

### Expected Behavior
Single scrub UI visible during clip playback.

### Actual Behavior
Two overlapping scrub/timeline elements visible, potentially one for the full game video and one for the clip region.

## Solution

Investigate which components render scrub UIs in annotate mode and ensure only one is visible during clip playback. Likely a conditional rendering issue — one scrubber should be hidden when the other is active.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/` — annotate mode components
- `src/frontend/src/screens/AnnotateScreen.jsx` — screen layout

### Related Tasks
- None
