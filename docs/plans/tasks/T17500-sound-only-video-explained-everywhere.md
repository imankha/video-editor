# T17500: Every video that plays sound only says why

**Status:** WIP
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

Since T17280 the upload dialog and an opened game tell the parent when this browser can play only the sound of an iPhone video. Other places that play a video can still show a black box with sound and no explanation: a play uploaded directly as a clip, and the saved short clip of a play after its game has expired. Every place that plays such a video should say the same plain thing and offer the same way out (open it in Safari, or set the iPhone to Most Compatible).

## How we got here

Owner ruling 2026-11-18 on the T17390 design: do only the low-risk work now (tell the parent about the known limitation, plus foundational work) and move the conversion feature to the Big-file upload and video conversion milestone. The design doc lists these gaps as R9 (saved clip extracts of an expired HEVC game are stream copies, still HEVC) and R10 (HEVC clips uploaded directly). T17370 covers the attach-footage path and is already in progress.

## Solution

Find every place that loads a game or clip video for playback in the editor (Annotate, Frame, Spotlight, the direct clip upload, the Finished player if it plays an original) and make each one show the existing `VIDEO_PICTURE_UNSUPPORTED` message when the browser reports sound with a 0 by 0 picture. Reuse the T17280 detector (`utils/videoMetadata.extractVideoMetadata`, `useVideo` `hasSoundButNoPicture`); do not add a second detector. No conversion, no new endpoint.

## Relevant Files

Start from `src/frontend/src/utils/videoMetadata.js`, `src/frontend/src/hooks/useVideo.js` and the T17280 notes. Knowledge doc: `.claude/knowledge/annotate.md`.

## Acceptance Criteria

- [ ] C1: Uploading a play directly as a clip from a file the browser cannot draw (audio plays, 0 by 0 picture) shows the same message as a game upload and is not accepted silently.
- [ ] C2: Opening Frame on a play whose saved clip is HEVC, in a browser without HEVC, shows the message instead of a silent black box.
- [ ] C3: A list in the task notes names every playback place checked and how each now behaves.
- [ ] C4: Normal H.264 videos show no message anywhere.
