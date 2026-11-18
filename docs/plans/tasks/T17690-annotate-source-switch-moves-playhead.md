# T17690: Switching video source in Annotate moves the playhead

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

In Annotate, a game can have more than one video (two cameras, or several files). The parent picks which one to watch in the source bar. When they switch the video source, the playhead jumps to a different point, so they lose their place in the game. Switching sources should keep the playhead where it was in the game. The app's own help text promises this: "Where two cameras filmed at the same time, tapping switches cameras without moving."

## How we got here

Owner report 2026-11-18 while testing: "the playhead changes when I switch the video source in annotate and it shouldn't." Not yet investigated; exact steps (which game, two cameras at the same time or videos one after another, phone or desktop) to be confirmed during reproduction. Related recent work: T17250 renamed the source bar's line-up control to "Line up" (SourceBar), and the multi-video scrub logic lives in `useMultiVideoScrub`.

## Repro steps (to confirm)

1. Open a game with two or more videos in Annotate (dev account with a multi-video game).
2. Play or scrub to a point in the middle, for example 12:30 of the game.
3. Tap a different video in the source bar.

**Expected:** the playhead stays at the same moment of the game (for cameras filmed at the same time, the same moment on the other camera; for videos one after another, the position does not change because of the switch itself).
**Actual:** the playhead moves to a different time.

## Solution

Find where a source switch sets the current time and keep the game-time position across the switch. Cover both overlapping cameras and sequential videos, and the Line up offset if one is set. No silent clamping: if the other video does not cover that moment, say so (existing copy if there is one) rather than jumping without explanation.

## Relevant Files

Start from `src/frontend/src/modes/annotate/hooks/useMultiVideoScrub.js`, `src/frontend/src/modes/annotate/hooks/useAnnotate.js`, `src/frontend/src/modes/annotate/SourceBar.jsx`, `src/frontend/src/screens/AnnotateScreen.jsx`. Knowledge doc: `.claude/knowledge/annotate.md`.

## Acceptance Criteria

- [ ] C1: With two cameras filmed at the same time, switching source keeps the same moment of the game (playhead time within one frame), with and without a Line up offset.
- [ ] C2: With videos one after another, switching source does not move the game playhead by itself.
- [ ] C3: If the chosen video does not cover the current moment, the parent is told, and the playhead does not move silently.
- [ ] C4: A browser check reproduces the move on master (red) and passes on the branch.
