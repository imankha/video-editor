# T17700: Sync cameras is hard to understand

**Status:** TODO (design ruled by the owner 2026-11-18)
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

A game can have several videos (a second camera, or the second half as its own file). The app places each one on the game's timeline by when it was filmed, and guesses when it cannot tell. "Line up" is how a parent fixes a wrong guess: they drag the video, or nudge it, to where it really happened, and tap Done. The owner, testing on 2026-11-18, could not tell what the Line up button does. If the owner cannot, a parent will not either: the button says only "Line up", nothing says what is lined up with what or why, and the explanation appears only after tapping it.

## How we got here

Owner report 2026-11-18 while testing T17690 (switching video source moves the playhead): "I'm confused as to what the line up button does", then: "we should ask a UX expert exactly how this should be designed, and yes, then add it as a bug." T17250 had just changed the control from a bare clock icon to the word "Line up". How it works today (from the code and `.claude/knowledge/annotate.md`, T8900 Fix-timing):

- Entry: the Line up control on a video in the source bar (`SourceBar.jsx`), or long-press / right-click a camera bar on the timeline (`AngleLanes.jsx`), or a row in the cameras popover.
- The Mark play area is replaced by a yellow strip (`FixTimingStrip.jsx`). Only that video's bar can be dragged; nudge buttons move it by 1 s or 0.1 s; the strip shows the running change ("+3.4s").
- For overlapping cameras the strip says to find a sound heard in both (a whistle, a big cheer); "Play this camera" and "Play main camera" each play about 3 s of the same moment so the parent can compare.
- Plays on that video preview in their new spots; nothing is saved until Done. Reset returns to the opening position; X or Esc cancels.
- Done writes the video's `offset_seconds` once (`PATCH /api/games/{id}/videos/{seq}/placement`).

## Solution

1. **UX design first.** A UX expert (the `ui-designer` agent) proposes how Line up should be presented and used: when the parent should even see it (only when a video's placement was a guess, or always), what the control says, how the parent learns what it does before tapping, what the strip shows, how a parent knows they got it right, and how it reads on a phone and a desktop. The proposal goes into `T17700-design.md` with the options, a recommendation and mockups.
2. **Owner approval** of that design (this task waits on the owner at that point).
3. **Build** the approved design. Keep the existing behavior and the single Done write; this is presentation and wording unless the approved design says otherwise.

Related: T17690 (switching source keeps the playhead; only covering videos choosable) depends on videos being lined up correctly. T17710 (automatic line-up by sound) is the later step that removes most manual lining up.

## Relevant Files

`src/frontend/src/modes/annotate/SourceBar.jsx`, `FixTimingStrip.jsx`, `AngleLanes.jsx`, `VideoLane.jsx`, `src/frontend/src/config/displayNames.js` (`ANNOTATE.LINE_UP`, `LINE_UP_VIDEO`, `fixTimingFor`, `FINISH_FIX_TIMING_FIRST`, `VIDEOS_HELP`). Knowledge docs: `.claude/knowledge/annotate.md`, `.claude/references/ui-style-guide.md`.

## Acceptance Criteria

- [ ] C1: `T17700-design.md` exists with the UX expert's options, recommendation and mockups for phone and desktop, and the owner has approved it (recorded under `## Ruling`).
- [ ] C2: A parent who has never used it can tell from the screen, before tapping, what Sync does and why their video might need it (checked against the approved design's wording).
- [ ] C3: The approved design is built at 390x844 and 1440x900; lining up a video still saves only on Done, and X still cancels.
- [ ] C4: Existing Line up tests (`SourceBar.lineUp`, `FixTimingStrip`, `AngleLanes.fixTiming`) still pass or are updated to the approved behavior.

## Ruling

**Owner, 2026-11-18 (complete):**

1. **Q1: Sync.** Drop the words "line up" everywhere in parent-facing copy. Parents read "line up" as a team lineup (think a baseball lineup). The control, panel and messages say Sync.
2. **Parents are not asked to sync by ear.** Remove the listen-for-a-whistle instructions, the step numbering built around listening, and the "Heard it later? Tap Earlier" rule. Our technology tries to sync by sound when both videos have sound (T17710), and the parent drags (or nudges) the camera to adjust. Until T17710 ships, the panel is a plain drag/nudge adjustment: say what to do in terms of what the parent sees (make both cameras show the same moment), not what they hear.
3. **Ideal:** the client analyses both waveforms and places the second camera at the best match as its starting position, which the parent then confirms or adjusts. The matcher must cope with microphones far apart across a field (sound arrives later at a far mic) and with a conversation or other noise right next to one mic. See T17710.
4. **Q2 to Q6: approved as recommended.** Q2: "It comes after" is remembered on that device only. Q3: after "Starts here", X keeps the rough spot and the strip says so. Q4: only Done saves; letting go of a drag no longer saves for cameras. Q5: reordering videos uploaded in the wrong order is a separate task, only if a parent reports it. Q6: add 10-second steps.
