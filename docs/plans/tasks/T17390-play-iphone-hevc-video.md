# T17390: Play iPhone videos in browsers that cannot decode HEVC

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

T17280 only tells the parent that an iPhone video cannot be shown. Parents on Windows Chrome or Edge without an HEVC decoder still cannot use that game. Make the video play for them.

## How we got here

Follow-up to T17280 (bug 62p). Cause: the upload stores the file as is, an iPhone HEVC file, and some browsers play only its audio. Needs a design choice before building: convert on upload (server or Modal), convert on demand, or both.

## Solution

A game filmed on an iPhone plays with its picture in every browser we support.

## Relevant Files

Not investigated. Start from the knowledge doc `.claude/knowledge/annotate.md` and the upload path named above.

## Acceptance Criteria

- [ ] C1: A design doc picks the conversion approach, with cost and time per hour of video, and the owner approves it.
- [ ] C2: An iPhone HEVC game plays with picture and sound in Chrome on Windows without an HEVC decoder.
- [ ] C3: Existing H.264 games are unchanged.
