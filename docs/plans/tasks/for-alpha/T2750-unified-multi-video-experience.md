# T2750: Unified Multi-Video Experience

**Status:** TODO
**Impact:** 7
**Complexity:** 6
**Created:** 2026-05-12
**Updated:** 2026-05-12

## Problem

When users upload 2 halves of a game, the experience is significantly different from a single-video game. They see "First Half" / "Second Half" tabs and must switch between them manually. The clip list filters by half, the timeline only shows one half at a time, and the user has to mentally stitch the experience together. This is confusing and adds friction — users expect the app to treat both halves as one continuous game.

## Solution

Simulate a combined video so that multi-video games feel identical to single-video games. The two physical video files are stitched into one virtual timeline. The user sees one continuous timeline, one clip list, and seamless scrubbing/playback across both halves. The "First Half" / "Second Half" tabs are removed.

Key behaviors:
- **Combined timeline**: Second half timestamps are offset by first half duration. A clip at 5:00 in the second half appears at (first half duration + 5:00) on the timeline.
- **Unified clip list**: All clips from both halves shown together, sorted by their virtual timestamp.
- **Transparent video switching**: As the user scrubs or plays past the first half's end, the video element switches to the second half source transparently.
- **Annotation playback already handles this** (useAnnotationPlayback with dual-video ping-pong). The normal annotate/scrub mode needs the same treatment.

## Context

### Relevant Files
- `src/frontend/src/containers/AnnotateContainer.jsx` - Half filtering logic (`filteredClipRegions`, `currentVideoSequence`)
- `src/frontend/src/screens/AnnotateScreen.jsx` - Half tab UI, passes filtered data to sidebar and view
- `src/frontend/src/modes/AnnotateModeView.jsx` - Video player, timeline, overlays
- `src/frontend/src/modes/annotate/hooks/useAnnotationPlayback.js` - Already handles multi-video playback (reference implementation)
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` - Virtual timeline builder (may be reusable)
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` - Clip list sidebar
- `src/frontend/src/hooks/useVideo.js` - Video element management (needs transparent source switching)
- `src/frontend/src/components/VideoPlayer.jsx` - Video player component
- `src/frontend/src/modes/annotate/components/AnnotateTimeline.jsx` - Timeline with clip regions

### Related Tasks
- T710 (Annotation Playback) - Established the dual-video ping-pong pattern
- Bug fix (2026-05-12) - Fixed playback showing titles only for highlighted half (partial fix; this task is the full solution)

### Technical Notes
- `useAnnotationPlayback` already solves this for playback mode using `buildVirtualTimeline`. The same virtual timeline concept needs to be applied to the normal annotate mode.
- Clip `endTime`/`startTime` are stored relative to their individual video file. The virtual timeline must map between per-video times and combined times.
- `videoSequence` on clips identifies which half they belong to. This stays — it's needed for video source selection.
- The existing half-tab filtering (`filteredClipRegions`) would be removed entirely.
- Video switching during scrub is the trickiest part — seeking past the half boundary must load the other video source without a jarring delay.

## Implementation

### Steps
1. [ ] Extend virtual timeline concept from playback to normal annotate mode
2. [ ] Remove "First Half" / "Second Half" tab UI
3. [ ] Show combined timeline with offset timestamps for second half
4. [ ] Unify clip list — all clips visible, sorted by virtual time
5. [ ] Implement transparent video source switching on scrub across half boundary
6. [ ] Ensure clip creation records correct per-video timestamps + videoSequence
7. [ ] Update framing/overlay modes if they also filter by half

## Acceptance Criteria

- [ ] Multi-video games show a single continuous timeline
- [ ] No "First Half" / "Second Half" tabs visible
- [ ] All clips from both halves appear in one sorted list
- [ ] Scrubbing across the half boundary switches video source transparently
- [ ] Clip timestamps display correctly in combined timeline
- [ ] Annotation playback still works (already does)
- [ ] Single-video games are unaffected
