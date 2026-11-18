# T17370: Attached footage with sound but no picture is caught

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

A parent can add more footage to a game after the first upload (the attach path). If that file is an iPhone video the browser cannot draw (sound plays, no picture), nothing warns them and the game ends up with a dead video. T17280 now catches this on the first upload only.

## How we got here

Follow-up to T17280 (bug 62p, merged 2026-11-18). The worker's notes say: the attach path (AttachVideoModal and AddFootageButton) does not run the picture check, and useFootageIntake marks a probe error generically.

## Solution

Attaching footage runs the same sound-but-no-picture check as the first upload and shows the same plain message.

## Relevant Files

Not investigated. Start from the knowledge doc `.claude/knowledge/annotate.md` and the upload path named above.

## Acceptance Criteria

- [ ] C1: Attaching a video the browser cannot draw (audio plays, 0 by 0 picture) shows the same message as the first upload and does not attach it.
- [ ] C2: Attaching a normal video still works.
- [ ] C3: A regression test covers the attach path.
