# T17710: Line up videos automatically by their sound

**Status:** TODO (future; not scheduled)
**Impact:** 7
**Complexity:** 6
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

When a game has two videos filmed at the same time (two cameras, two phones) and both have sound, the app could line them up by itself: the same whistle, cheer or ball strike is heard in both, so matching the sound tells us exactly how far apart they are. The parent would not have to drag or nudge anything; they would only confirm. Manual Line up (T17700) stays for videos without sound or where the match is unsure.

## How we got here

Owner request 2026-11-18, after T17700: "a future task would be to check if both had audio and if they do, to line up automatically based on sound waves. Add that to the plan as well." Today the app places videos by their recorded time stamps and falls back to putting a video after the previous one; a wrong guess is fixed by hand with Line up, whose own help text already tells the parent to listen for a shared whistle or cheer.

## Solution (to be designed)

When a second video is added to a game and both videos have an audio track, compute the offset by cross-correlating their audio (downmixed, resampled, perhaps band-limited), and score how confident the match is. Where to run it (in the browser at upload, on the server, or on Modal), how long a window to compare, and how to handle crowd noise, wind and different microphones are design questions. A confident match places the video automatically and tells the parent it was lined up by sound, with Line up still available to adjust; a weak match does nothing silently but says it could not match the sound.

## Relevant Files

Not investigated. Placement write: `PATCH /api/games/{id}/videos/{seq}/placement` (`update_video_placement` in `games.py`), timeline model `buildGameTimeline`. Knowledge docs: `.claude/knowledge/annotate.md`, `.claude/knowledge/modal-gpu.md`.

## Acceptance Criteria

- [ ] C1: A prototype measures the offset on real pairs of game videos (two cameras, different phones, outdoor crowd noise) against a hand-lined-up truth, and reports accuracy (within 0.1 s?) and failure rate.
- [ ] C2: A design with the owner's approval picks where it runs, the confidence rule, and what the parent sees.
- [ ] C3: Two overlapping videos with sound are lined up within the approved accuracy with no parent action, and the parent is told.
- [ ] C4: A video without sound, or a weak match, is left to manual Line up with a clear message; nothing is moved silently.
