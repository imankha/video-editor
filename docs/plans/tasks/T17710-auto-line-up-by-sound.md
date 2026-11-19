# T17710: Sync videos automatically by their sound

**Status:** TODO (future; owner ruling 2026-11-18 sets the approach)
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

- [ ] C1: A browser prototype measures the offset on real pairs of game videos against a hand-synced truth, including mics far apart on a field and a conversation close to one mic, and reports accuracy (within 0.1 s?), failure rate and time to compute for a 90-minute game.
- [ ] C2: A design with the owner's approval picks where it runs, the confidence rule, and what the parent sees.
- [ ] C3: Two overlapping videos with sound are lined up within the approved accuracy with no parent action, and the parent is told.
- [ ] C4: A video without sound, or a weak match, is left to manual Line up with a clear message; nothing is moved silently.

## Ruling

**Owner, 2026-11-18:** parents are not asked to sync by ear (T17700). When both videos have sound, our technology tries to sync them, and the parent drags to adjust. Ideally the **client** (the parent's browser) analyses both waveforms and uses the best match as the second camera's **starting position**, which the parent then confirms or adjusts by dragging. The matcher must account for:

- **Microphones far apart.** Two phones at opposite ends of a field hear the same whistle at different times (sound travels about 343 m per second, so 100 m adds about 0.3 s). The match is the offset that best explains the shared events, not a sample-exact identity; report it as an estimate the parent can adjust.
- **Foreground sound at one mic.** A conversation, wind or a parent cheering right next to one phone is loud on that track only. Prefer events both mics hear (whistles, horns, crowd swells, ball strikes): for example, match on onset or energy envelopes in frequency bands where field sounds dominate rather than raw samples, weight by agreement across several windows of the game, and require a clear winner over the next-best offset.
- **Confidence.** A weak or ambiguous match must not move the video silently: leave it where the clocks put it, tell the parent we could not sync by sound, and let them drag.

Where it runs: client first (owner preference). A server or Modal fallback is a design question only if the prototype shows the browser cannot decode or process the audio fast enough (for example iPhone HEVC files in some browsers, see T17390).
