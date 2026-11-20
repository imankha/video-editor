# T16203: Highlight my athlete in AI plays

## In plain words

After AI Coach has marked a game and the parent has said which player is their child (T16200), the child's plays still look like everyone else's: a clip of twenty players, and the viewer has to find the right one. The analysis now stores where each noted player is during the first two seconds of every play, as four boxes (T16150). We will use them: when a play is in My athlete and the parent marked one of its players as their athlete, the play opens with a highlight on that player for its first two seconds. Nobody draws anything. Parents get the "that one is mine" moment the feature promises; without it an AI play is harder to read than one the parent marked by hand. Done when a My athlete play made by AI Coach shows the highlight on the right player on a phone and on a desktop, and a play without boxes plays exactly as today.

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Tier:** M (frontend playback plus one flag; the boxes are already in the play)
**Created:** 2026-11-20

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Runs after T16200. Owner request 2026-11-20.

## Problem

The model cannot tell which child is the parent's, and a sideline camera shows the whole field. T16200 lets the parent say "this is my athlete" on a play, but that only moves the play to the My athlete lane. The picture does not change.

## Solution

1. **The data.** T16150 stores, for each noted player in a play, four boxes at the play's start + 0, 2/3, 1 1/3 and 2 seconds (or "not visible"). T16190 copies them into the imported play beside that player's mention. This task adds nothing to what is stored: the highlight is drawn from those four boxes every time, never saved as a second copy.
2. **When it shows.** The play is in My athlete, one of its mentions is marked as the athlete (`ai_source.mentions[].assigned`, written by T16200), and that mention has at least two visible boxes. Otherwise nothing is drawn.
3. **What it looks like.** The same highlight shape the Spotlight step draws, moved smoothly between the four boxes over the first two seconds, then faded out. The UI designer confirms size and fade against the style guide before build.
4. **Wrong box.** The prototype counts how often a box sits on the wrong player. The play editor gets one control, "Highlight is on the wrong player", which turns the highlight off for that play (one write of one flag, from that tap).
5. **Measure.** `ai_highlight_shown` and `ai_highlight_rejected`, so the Journey shows how often the boxes were right enough to keep.

## Why this and not something else

Tracking the child through the whole game from one tap was prototyped on 2026-11-20: the model re-finds a clear player but names somebody even when the child is not in the picture, and a whole game costs several dollars per child. Four boxes at the start of each play are cheap, are checked by eye in the prototype, and are enough to point at the child. Saving the highlight as an overlay on the play was ruled out because it would be a second copy of the boxes that can drift from them.

## For the implementer

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/` (play playback and the play editor, where a My athlete play is shown)
- the Spotlight highlight renderer under `src/frontend/src/modes/overlay/` (reuse the shape; do not fork it)
- `raw_clips.ai_source` as written by T16190 and T16200
- `src/backend/app/analytics.py` (two events)

### Technical Notes
- Boxes are optional everywhere. A play with no boxes, fewer than two visible boxes, or no assigned mention plays exactly as today.
- Interpolate linearly between visible boxes; hold the last visible box until 2 s; do not extrapolate before the first.
- Box coordinates are 0 to 1000 of the source frame; convert with the video's own dimensions.
- The "wrong player" flag is the only new persisted value, written by its own gesture.

### Related Tasks
- Depends on: T16150 (boxes stored), T16190 (boxes copied on import), T16200 (athlete marked). Related: T16204.

## Acceptance Criteria

- [ ] A My athlete play from AI Coach whose assigned mention has boxes opens with a highlight that follows the four boxes over the first two seconds and then fades.
- [ ] A Team play, a play with no assigned mention, and a play with fewer than two visible boxes show no highlight and play as today.
- [ ] "Highlight is on the wrong player" turns the highlight off for that play with one write, and it stays off after reload.
- [ ] Nothing derived from the boxes is stored; the stored play is unchanged by viewing it.
- [ ] `ai_highlight_shown` and `ai_highlight_rejected` appear in the admin Journey inspector.
