# T16770: Second play lands after first (possible)

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-16
**Updated:** 2026-11-17

## In plain words

**Today.** In Annotate a parent watches the game and taps "Mark play", which saves the last 6 seconds and the next 2 as a play. After the first play on a new account, a prompt asks "Make this a highlight now?" with "Keep marking plays" underneath.

**The problem (possible, needs a repro).** Seen once in the staging QA pass on 2026-11-16. The first play (14 to 22 seconds) was looping in its play view when "Keep marking plays" was tapped. The playhead was then moved to 0:45 and "Mark play" tapped a second later, but the second play was saved at 16.5 to 24.5 seconds, just after the first, not around 0:45. That suggests the first play's loop was still holding the playhead after the prompt closed. Later tries could not reproduce it, because the prompt only appears on an account's very first play. A Done from "Edit play" while the play looped returned to normal game playback correctly. If real, a new parent's second play lands in the wrong place without any warning.

**What we will do.** First reproduce with a fresh account: mark a play, press Play so it loops, press Done, choose "Keep marking plays", then scrub elsewhere and mark again. If the second play is misplaced, end the first play's loop when the prompt is dismissed.

**Why this and not something else.** The other exit (Edit play then Done) already returns to game playback correctly, so the fix is local to the prompt's path.

**How we will know it worked.** On a fresh account, after "Keep marking plays", a play marked at 0:45 is saved at 0:39 to 0:47.

## Evidence (staging, build 94928afa1, account e2e@test.local)

- Game 16 "qa-game-2026-11-16". Play 1 saved at 14 to 22 s (marked at 20 s). Play 1 was playing in its looped view; "Keep marking plays" tapped; `video.currentTime = 45` set 1.2 s later; "Mark play" 0.8 s after that. Play 2 saved at 16.5 to 24.5 s.
- Console showed the loop seeking back to 14.0 every 8 s before the prompt.
- Not reproduced on games 17 and 18: the prompt did not appear again for this account.

## Implementer notes

- Annotate mode, first-play prompt ("Make this a highlight now?" / "Keep marking plays") and the play-loop playback in `src/frontend/src/modes/` (annotate). See `.claude/knowledge/annotate.md`.

## Reproduction result

**Reproduced (2026-11-17, local dev stack, fresh `full` preset account), with the highlight save held 8 s by a
Playwright route (a slow network).** Steps: mark play 1, rate it Highlight, Done, tap "Keep marking plays". On the old code
the card stays up (button disabled) for the whole save, so the user cannot move the playhead. Only when the save returns
does the app close the card and seek to play 1's end + 0.25 s. Any seek made meanwhile is overwritten, which is what QA's
script did on staging (`video.currentTime = 45` 1.2 s after the tap). The staging numbers match exactly: play 2 at
16.5 to 24.5 s was marked at 22.25 s plus a little playback, i.e. play 1's end (22 s) + 0.25 s. The unit test reproduces
the overwrite directly: with the save held, the old code issued the seek only after the save landed.

The dev preset's only game has two videos. There, a direct write to `<video>.currentTime` while paused never reaches
the app's playhead (the multi-video hook reads the element's time only while playing). So a QA-style DOM write cannot show
the bug on this account: it gave the same misplaced play (36.25 to 44.25 s, play 1 ended at 42.0 s) before AND after the
fix (`qa/repro-T16770-dom-seek.log` is the old-code run). The browser check therefore moves the playhead the way a user does, with the
transport.

**Cause.** `handleHighlightChoiceLater` (AnnotateContainer.jsx) waited for the highlight save (PUT with
`create_project`) to come back. Only then did it close the card, deselect the play and seek the playhead to just past it
(T15550/T15930). A seek made while the save was out was overwritten when the save landed. The play's loop is not the
cause: it stops when the editor closes.

**Fix.** Close the card, deselect and nudge the playhead at the tap, then wait for the save. The user is back on Mark Play
right away, and a slow save can no longer move the playhead. A failed save already closed the card before the fix, and the
write queue's Retry toast is still where a failure shows. Proof: `AnnotateContainer.highlightChoiceKeepMarking.test.jsx`
T16770:C2 (the save is held: the playhead is nudged at the tap and nothing seeks after the save lands), and
`e2e/checks/T16770.check.spec.js`.

## Acceptance Criteria

- [x] Reproduced (or ruled out) on a fresh account with the exact steps above; result recorded here.
- [x] If reproduced: after "Keep marking plays", seeking and marking saves the play around the new playhead (browser check).
