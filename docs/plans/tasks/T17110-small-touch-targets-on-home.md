# T17110: Small touch targets on Home

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

On a phone and an iPad, several buttons on Home are smaller than the 44 pixel minimum a finger needs, so parents miss them or hit the wrong one. They are the storage banner's "Extend storage" link and its Dismiss X, the "Retry upload" and "Discard" buttons on games whose upload did not finish, and (on phones) the "Report a problem" button at the bottom of Home. These were not in the list that T16210 is re-measuring.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as e2e@test.local, by the layout sweep script at 390x844, 360x640 and 768x1024 touch.

## Repro steps

1. Sign in as e2e@test.local on a touch screen at 390x844 (or 360x640, 768x1024).
2. Open Home, Games tab (the account has a storage banner and several "Upload incomplete" games).
3. Measure each control's box.

**Expected:** every control is at least 44 by 44 pixels.
**Actual:** under 44 pixels: "Extend storage" and "Dismiss" on the storage banner (all three sizes), "Retry upload of ..." and "Discard ..." on each failed-upload tile (all three sizes, 19 controls at 390), "Report a problem" (390 and 360, Plays and Highlights tabs).
**Repeats:** always (every load at every size)
**Also checked at:** desktop not applicable (mouse).

## Evidence

- Screenshots: `.playwright-mcp/sweep-p390-_home_games.png`, `sweep-p360-_home_games.png`, `sweep-ipad768-_home_games.png` copied to `qa/qa-pass-2026-11-17/bugs/r2-B11-*.png` (local, not in git)
- Console, network, server log: nothing relevant.

## Solution

Each of these controls has a touch area of at least 44 by 44 pixels on touch screens.

## Relevant Files

Not investigated. See T16210 for the earlier list.

## Acceptance Criteria

- [ ] C1: At 390x844 touch, the storage banner's two controls, failed-upload Retry and Discard, and "Report a problem" each measure at least 44x44.
- [ ] C2: The same at 360x640 and 768x1024.
