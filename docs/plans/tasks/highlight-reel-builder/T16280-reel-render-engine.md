# T16280: Reel render engine

## In plain words

Today the app joins highlights (finished short clips) for a download by gluing the files end to end, which takes seconds but can only cut from one to the next. A reel (several highlights joined into one video) with a fade or a crossfade needs the picture around each join re-made, and a card (a still screen with words) needs turning into video of an exact length. This builds the server job that takes a reel's running order and produces one file: every highlight, every join with its transition and length, every card with its length. It also measures what nobody knows yet: how long a parent waits and what it costs us when a reel has fades in it. Done when a ten-highlight reel with mixed transitions and three cards comes out on staging with every length right, and a reel with only cuts is still as fast as today.

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-11-12
**Updated:** 2026-11-12
**Milestone:** Highlight reel builder (see [EPIC.md](EPIC.md)). Task 2 of 5.
**Waits on:** the decision page linked in the epic. Choices 3, 4 and 8 (which transitions, their lengths, and sound) set what this job must render.

## How we got here

The first version of the reel (T11300) exports with straight cuts, or with one fade to black for the whole reel. On 2026-11-12 the owner asked for transitions the parent can define and cards with defined lengths. The joining code the app has today never re-makes the picture unless the files do not match, and the service the app rents for video work has never rendered a crossfade.

## The problem

A crossfade shows two highlights at once, so both must be decoded and blended, and the reel gets shorter by the length of each crossfade. A fade through black must also fade the sound. Cards arrive as pictures and must become video that matches the highlights around them exactly, or the join stutters. None of this exists, and the wait and the cost are unknown.

## What we will do

1. Accept a running order: highlights and cards in sequence, a transition and a length for each join, a length for each card, and whether the reel is muted.
2. Render cut, fade through black and crossfade, with the sound fading in step with the picture.
3. Turn each card into video of exactly its length, in the same size and frame rate as the highlights.
4. Keep the fast path: a reel with only cuts is joined without re-making the picture, as today.
5. Report real progress while it works (for example, 4 of 10 joins done), so the screen never shows an invented percentage.
6. Measure the wait and our cost for a one-minute, a three-minute and a five-minute reel with a fade at every join, and write the numbers into this file.

## Why this and not something else

Re-making the whole reel whenever one join fades is the simple way and may be fast enough. Re-making only the second around each join is faster but far harder to get right. This task measures the simple way first and only builds the harder one if the wait is too long for a parent to sit through.

## How we will know it worked

- [ ] The owner has ruled on choices 3, 4 and 8 of the decision page, and the answers are recorded in this file.
- [ ] A reel of ten highlights with cut, fade and crossfade joins and three cards renders on staging; every transition and card is within a tenth of a second of the length asked for.
- [ ] The total length of the file equals the sum of the items minus the overlap of each crossfade.
- [ ] Sound fades with the picture at a fade or crossfade, and a muted reel has no sound.
- [ ] A reel with only cuts finishes in the same time as a joined download today.
- [ ] The wait and the cost of the three measured reels are written in this file.
- [ ] A render interrupted by a restart finishes or fails cleanly; it never leaves a half-made file as the reel.

## For the implementer

### Related Tasks
- Depends on: T11300's `reels` and `reel_members` tables and `POST /api/reels/{id}/export`. T11300's design doc must already carry a per-join transition and length and a per-card length.
- Blocks: T16290, T16300.

### Relevant Files (REQUIRED)
- `src/backend/app/services/ffmpeg_concat.py` - `concat_segments` (copy path stays; new transition path)
- `src/backend/app/modal_functions/video_processing.py` - `stitch_members`
- `src/backend/app/services/serve_time_video.py` - card compose (`compose_serve_time_dispatched`)
- `src/backend/app/routers/reels.py` (new in T11300) - export endpoint and progress
- `src/backend/app/services/publish_final_video.py`

### Technical Notes
- ffmpeg `xfade` and `acrossfade` need a full decode of both neighbours and constant frame rate; offsets are cumulative, so compute them from probed lengths, never from stored ones.
- Load `.claude/knowledge/export-pipeline.md` and `.claude/knowledge/modal-gpu.md` first.
- Progress follows the T7050 rule: only report what the server has finished.
