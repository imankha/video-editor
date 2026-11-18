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

Find where a source switch sets the current time and keep the game-time position across the switch. Cover both overlapping cameras and sequential videos, and the Line up offset if one is set. Owner rule (2026-11-18): the parent can only switch to a video that covers the moment the playhead is on. In the source bar, a video that does not cover the current playhead time is shown but cannot be chosen (disabled, with a short reason on hover or tap, for example that it does not cover this moment), and it becomes choosable again as soon as the playhead moves into its span. So a switch never has to move the playhead.

## Relevant Files

Start from `src/frontend/src/modes/annotate/hooks/useMultiVideoScrub.js`, `src/frontend/src/modes/annotate/hooks/useAnnotate.js`, `src/frontend/src/modes/annotate/SourceBar.jsx`, `src/frontend/src/screens/AnnotateScreen.jsx`. Knowledge doc: `.claude/knowledge/annotate.md`.

## Acceptance Criteria

- [ ] C1: With two cameras filmed at the same time, switching source keeps the same moment of the game (playhead time within one frame), with and without a Line up offset.
- [ ] C2: With videos one after another, switching source does not move the game playhead by itself.
- [ ] C3: A video that does not cover the current playhead moment cannot be chosen in the source bar: it is visibly disabled with a short reason, and becomes choosable once the playhead moves into its span (owner rule 2026-11-18).
- [ ] C4: A browser check reproduces the move on master (red) and passes on the branch.
- [ ] C5: Choosing a video in the source bar actually shows that video: the player's picture and sound switch to the chosen source (its video element's src is the chosen video and its frames are what is drawn), and the source bar marks it as the one playing. Owner report 2026-11-18: choosing another video did not seem to show it.

## Ruling

**Only covering videos are choosable** (owner, 2026-11-18): "I should only be able to switch to videos that occur over the duration of where the playhead is." Reflected in Solution and C3.

**Switching must show the chosen video** (owner, 2026-11-18): "switching to that video should show that video, doesn't seem to be the case." Added as C5; the C4 browser check covers it too (red on master if it reproduces).
