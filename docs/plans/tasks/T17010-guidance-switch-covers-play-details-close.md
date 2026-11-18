# T17010: Guidance switch covers Tags and Notes close

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

On a phone, when a parent opens "Details" on a play to add tags and a note, the "Tags and Notes" sheet has a close X in its top right corner. The Guidance switch sits exactly on top of that X. A parent who taps the X to close the sheet turns Guidance on or off instead, and the sheet stays open. This was fixed once before (T13770, October) and has come back. The X should be tappable and the switch should not cover it.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as the new parent account imankh+qa-2026-11-17b@gmail.com, at phone 390x844 touch. Same class of bug as T13770 (DONE 2026-10-28), which fixed the Play details sheet and Plays drawer.

## Repro steps

1. Sign in on a phone-sized touch screen (390x844), Guidance on.
2. Open a game with at least one play (Home, Games, tap the game).
3. Select a play, tap "Edit play", then tap "Details".
4. Look at the top right of the "Tags and Notes" sheet.

**Expected:** the sheet's close X is visible and a tap on it closes the sheet.
**Actual:** the Guidance switch box (x 269 to 374, y 16 to 60) covers the close X (x 338 to 382, y 14 to 58); a tap at the X's centre lands on the Guidance switch.
**Repeats:** 3 of 4 tries (the miss was a load where the page had scrolled, so the switch was off screen)
**Also checked at:** desktop 1440x900 opens a different layout without this sheet. iPad not checked yet.

## Evidence

- Screenshot: `qa/qa-pass-2026-11-17/bugs/r2-B01-guidance-covers-close.png`, `r2-B01-repro.png` (local, not in git)
- Console: no errors at the moment of the bug.
- Network: no failing requests.
- Server log: nothing relevant (fly logs checked, warnings only about game details).

## Solution

On a phone, the Guidance switch never sits on top of the close button of any open sheet.

## Relevant Files

Not investigated. Prior fix: T13770 (`docs/plans/tasks/T13770-guidance-switch-covers-annotate-sheet-close-390.md`).

## Acceptance Criteria

- [ ] C1: At 390x844 with Guidance on, the "Tags and Notes" sheet's close X is not covered by the Guidance switch and a tap on it closes the sheet.
- [ ] C2: The same holds at 360x640 and at iPad 768x1024.
