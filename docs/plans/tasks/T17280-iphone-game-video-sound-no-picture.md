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
