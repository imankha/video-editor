# T980: Clip-Scoped Scrub Bar in Play Annotations

**Status:** TESTING
**Impact:** 5
**Complexity:** 4
**Created:** 2026-04-03
**Updated:** 2026-04-03

## Problem

In Play Annotations mode, the playback controls show a single progress bar spanning the full virtual timeline (all clips concatenated). The user can see which clip is playing (segment markers divide the bar), but there's no way to scrub within just the current clip. For an 8-second clip inside a 2-minute playback, the per-clip scrub resolution is very low.

### Expected Behavior
A secondary clip-scoped scrub bar (below the main timeline) showing 0:00 → clip duration for the active clip, with click-to-seek within that clip.

### Actual Behavior
Only the full-playback progress bar exists. The clip name and time (e.g., "0:12 / 0:14") are shown in text but there's no clip-scoped scrubber.

## Context

T850 removed a *duplicate* scrub bar that was a rendering bug (two identical scrubbers stacked). This task adds an *intentional* second scrub bar with different scope — the main bar spans all clips, the new bar spans just the active clip.

T830 implemented a similar clip-scoped scrub bar for the GameClipSelectorModal preview player and can serve as a UI reference.

### Current Architecture

PlaybackControls receives these relevant props:
- `virtualTime` — current position in the full virtual timeline
- `totalVirtualDuration` — total duration of all clips
- `segments` — array of `{clipId, virtualStart, virtualEnd, ...}` for each clip
- `currentSegment` — the active segment object
- `activeClipName` — display name of the active clip
- `onSeek(virtualTime)` — seek to absolute virtual time
- `onSeekWithinSegment(fraction)` — seek within the current segment (0-1 fraction) — **already exists as a prop but is unused since T850 removal**

The `onSeekWithinSegment` prop is the key integration point — it was wired up for the old clip scrub bar and should still be connected from the parent.

### Relevant Files
- `src/frontend/src/modes/annotate/components/PlaybackControls.jsx` — add clip scrub bar here
- `src/frontend/src/modes/annotate/PlayAnnotationsMode.jsx` — parent that provides onSeekWithinSegment

### UI Design
- Position: below the main progress bar, above the controls row
- Style: thinner than main bar (h-2 vs h-6), green fill (matches clip color scheme), with clip name and time label
- Shows: clip name on left, clip-relative time on right (e.g., "Assist - 0:04 / 0:08")
- Click-to-seek maps 0-1 fraction to onSeekWithinSegment

### Related Tasks
- T850: Removed duplicate scrub bar (rendering bug) — this adds it back intentionally with proper UX
- T830: Clip-scoped scrub bar in GameClipSelectorModal (UI reference)
