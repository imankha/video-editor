# T13540: Uploading a video that is already inside a game opens that game with only the short video and all plays squeezed into it

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Tier:** M (frontend upload/dedup flow, maybe backend)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, 1440x900 (report bug 37, screenshots `BUG-37a-dup-upload-new-game-1440.png`, `BUG-37b-dup-upload-toast-under-shade-1440.png`, `BUG-37c-dup-upload-plays-clamped-1440.png`).

## Problem

`game2-test.mp4` (5 s) had been added to "Vs Carlsbad QA" with Add footage. Uploading the same file again as a new game:

1. Annotate opens a new empty game ("Getting your game ready...").
2. It then jumps to "Vs Carlsbad QA", but loaded with only the 5 s green video (no "Video 1 of 2" picker), and all 5 plays clamped into 0:00-0:05 (Plays 2-4 listed at 0'04").
3. The "Already in your library" toast is blurred under the coach shade; the coach says "Tap Play to watch the game...".

Reopening the game from Home shows it intact (89 s, plays at 0:26/0:43/1:01). No credits charged. Editing a play in the clamped state may save wrong times (not tried; check it).

## Repro steps

1. Have a game whose second video (Add footage) is a small file X.
2. Home > Upload game > choose the same file X > Upload game.
3. Watch Annotate for 10 s; then open the play list.

**Expected:** a readable message that this video is already in game "Vs Carlsbad QA", then that game opens normally with all its videos and correct play times (or a new game, if that is the intended behavior).
**Actual (before fix):** the game opens with only X and plays clamped to X's length; the toast is unreadable.

## Context

### Relevant Files
- Upload dedup handling (search "Already in your library") and game load / activate in Annotate
- `.claude/knowledge/annotate.md`, `.claude/knowledge/persistence-sync.md`

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro and record the clamped play times and the missing video picker; write a test that loads a multi-video game via the dedup path and asserts all videos and original play times, see it fail.
2. **After the fix:** same file, same game: correct videos and play times, readable message. Also confirm editing a play right after landing keeps its real times.

## Acceptance Criteria

- [ ] Re-uploading a video already in a game never shows the game with missing videos or clamped plays
- [ ] The duplicate message is readable (not under the shade) and names the game
- [ ] No play times are saved from the clamped state
- [ ] Test fails before, passes after; before/after recorded
