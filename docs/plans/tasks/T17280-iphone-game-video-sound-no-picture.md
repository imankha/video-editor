# T17280: iPhone game plays sound but no picture

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

A parent opened a game they had uploaded from an iPhone. The video would not show: they heard the sound but saw no picture. Without the picture the parent cannot mark any plays, so the game is unusable.

## How we got here

Production bug report 62p (2026-11-15, build d4e2f12dc), description: "sound is playing but video is not playing. taken with an iPhone". Game "IMG_0128" (game id 1) in Annotate on a 1912x948 desktop window. The report's editor state shows video duration 0, not loading, not playing, no plays marked. Not investigated yet. Likely suspects: the file's video codec (iPhone HEVC or a MOV the browser cannot draw), or the upload never producing a playable copy. Fetch it with `/bug 62p` for the full report.

## Repro steps

1. Upload a video recorded on an iPhone as a game (try an HEVC file and a standard H.264 file).
2. Open the game in Annotate.

**Expected:** the picture and sound play.
**Actual (62p):** sound plays, no picture, duration reads 0.

## Solution

An iPhone video plays with its picture in Annotate. If the cause is a codec the browser cannot draw, the upload makes a copy it can play, or the parent is told plainly before it is too late. Find the real cause first and record it in the notes.

## Relevant Files

Not investigated. Start from the knowledge doc `.claude/knowledge/annotate.md` and the game upload and playback path.

## Acceptance Criteria

- [ ] C1: The cause of bug 62p is identified and written in the task notes with evidence.
- [ ] C2: A game uploaded from an iPhone (the cause's file type) shows its picture and plays with sound in Annotate.
- [ ] C3: A regression test covers the cause.

## Notes

### Cause (C1, 2026-11-18)

Evidence (from bug 62p, fetched by the owner): Windows Chrome/Edge 157 desktop. At open, Annotate warned
`Game 1: video dimensions unknown (no element metadata and no game row video_width/video_height)`. The
client logs had no `VIDEO_LOAD` lines and no video element errors. Later uploads retried and finally
failed with `Insufficient credits: need 2, have 1`.

Mechanism: an iPhone records HEVC (High Efficiency) by default. Chrome on Windows can decode HEVC only with
a hardware decoder. Without one, it loads the file as audio only: `loadedmetadata` fires with a real
duration, `videoWidth`/`videoHeight` are 0, and no media error is raised. The code accepted that:

- `utils/videoMetadata.extractVideoMetadata` (the Upload dialog's probe, T12830) resolved `{width: 0, height: 0}`.
- `uploadGame` sends `width: options.videoWidth || null`, so the game row stored no dimensions. That is the
  "dimensions unknown" warning.
- `useVideo` played the sound over a blank stage with no message.

The retries and the credit failure follow from the parent trying again after seeing no picture.

Fix: the probe rejects a file with sound but a 0x0 picture (`VideoPictureUnsupportedError`,
code `VIDEO_PICTURE_UNSUPPORTED`). The Upload dialog then tells the parent plainly, before anything is
uploaded or charged: use Safari, or set iPhone Camera > Formats to Most Compatible.
For a game already uploaded this way, `useVideo` shows the same message as a video error instead of playing
sound over a blank stage. `handleLoadedData` no longer clears that error.

Not done (follow-up): no transcoded H.264 copy is made, so such a game still cannot show its picture in that
browser. Also, `uploadStore.onEntryError`'s insufficient-credits branch retires the entry even when
`uploadGame` kept the pending game (T8180, the user was annotating), which leaves a pending game with no
Retry/Discard.
