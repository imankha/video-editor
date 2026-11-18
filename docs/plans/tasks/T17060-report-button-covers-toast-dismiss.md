# T17060: Report button covers toast Dismiss

**Status:** WIP
**Impact:** 3
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## Progress Log

- 2026-11-17 (same QA pass, later): confirmed a second overlap by measurement. In Mark Plays at 1440x900 with a play selected, the round "Report a problem" button (x 1382 to 1424, y 778 to 820) covers the lower right of the "Make highlight" card (ends at x 1411, y 796). Screenshot `qa/qa-pass-2026-11-17/bugs/r2-B06-report-covers-make-highlight.png`. So the floating button overlapping content is confirmed; the toast case is still seen once.

## In plain words

On a desktop, the round "Report a problem" button in the bottom right corner sat on top of the "Dismiss" button of the "Your highlight is in Highlights" message, covering its right edge. A parent clicking near that edge opens the problem report instead of closing the message. The floating button should not cover any message's buttons.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as imankh+qa-2026-11-17b@gmail.com, at desktop 1440x900. The message hid itself before its position could be measured, so this rests on one screenshot.

## Repro steps

1. Sign in on desktop 1440x900 with a highlight that just finished (so "Your highlight is in Highlights" shows on Home).
2. Load Home.
3. Look at the bottom right: the message with "View" and "Dismiss", and the round "Report a problem" button.

**Expected:** the two do not overlap.
**Actual:** the "Report a problem" button covers the lower right of "Dismiss".
**Repeats:** seen once (possible)
**Also checked at:** phone and iPad put "Report a problem" at the bottom of Home instead, so they are not affected.

## Evidence

- Screenshot: `qa/qa-pass-2026-11-17/bugs/r2-B06-report-covers-dismiss.png` (local, not in git)
- Console, network, server log: nothing relevant.

## Solution

On desktop, the floating "Report a problem" button never covers a message or its buttons.

## Relevant Files

Not investigated.

## Acceptance Criteria

- [ ] C1: At 1440x900 with the "Your highlight is in Highlights" message showing, "Dismiss" is fully clickable and not covered by "Report a problem".
- [ ] C2: The same at 1280x800 and 1920x1080.
