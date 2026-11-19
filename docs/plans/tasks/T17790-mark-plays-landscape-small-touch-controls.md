# T17790: Landscape controls miss finger size

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

A parent turns a phone sideways to mark plays. The four main action buttons are only 38 pixels high, and the All filter is only 34 pixels wide. These controls fall below the required 44 by 44 touch target.

## Reproduction

Open qa18-game in Mark Plays as e2e@test.local in a real touch context at 844 x 390. Wait for the video to be ready. Measure All and the Mark play, Watch plays, Share game and Add video buttons. All is 33.56 x 44; the four actions are each 126.5 x 38. These dimensions repeated on three fresh loads.

Returning parent flow, staging build 91f0e6792 (#8105), 2026-11-18. Expected: a minimum 44 x 44 touch target on coarse pointer devices. Actual: dimensions above. Three fresh loads reproduced the measured fault. This reports one grouped issue per screen, not each button as a separate task.

## Evidence and logs

Local folder: qa/qa-pass-2026-11-18/bugs/. B12-annotate-landscape-1.png through B12-annotate-landscape-3.png; measured rectangles B12-annotate-targets.json. No failing API request or JavaScript exception established as the cause; this is a measured layout failure. Server logs are not relevant to the CSS hit target. Other request errors in this pass are tracked separately.

## Solution

Give the affected touch controls at least a 44 x 44 hit area without covering neighboring controls.

## Relevant Files

src/frontend/src/modes/annotate and its action bar/filter controls.

## Acceptance Criteria

- [ ] C1: A browser check at the stated real-touch sizes confirms every listed control is at least 44 x 44 pixels.
- [ ] C2: The expanded hit areas do not overlap other controls or hide labels.
