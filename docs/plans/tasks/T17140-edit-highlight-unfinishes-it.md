# T17140: Opening Edit highlight un-finishes it

**Status:** WIP
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

A parent opened a finished highlight with "Edit highlight" (from its tile menu on the Highlights tab), looked, and left without changing anything. Afterwards the highlight was gone from the Highlights tab (9 became 8) and showed up on the Plays tab as "In progress, Private, Source expired" with "Finish" and "Preview". Just opening a highlight to look at it should never take it out of Highlights or make it private. In this case its game had expired (see T17070), so the parent cannot easily finish it again.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as e2e@test.local, at desktop 1440x900, on the highlight "Play 1" of game "varA" (an expired game).

## Repro steps

1. Sign in as e2e@test.local, 1440x900. Note the Highlights count (was 9) and Plays count (was 4).
2. Highlights tab, open the "varA" group, tile menu, "Edit highlight". Frame opens (with the expiry message from T17070).
3. Go back Home without changing anything.

**Expected:** Highlights still 9, the highlight still finished and shared as before.
**Actual:** Highlights 8, Plays 5; the Plays tab lists "varA, In progress, Private, Source expired, Play 1 0'02" with Finish and Preview".
**Repeats:** seen once (the only finished highlight on an expired game that was opened); not repeated, to avoid losing more test data.
**Also checked at:** not checked on phone or iPad.

## Evidence

- Screenshot: `qa/qa-pass-2026-11-17/bugs/r2-B15-unfinished-in-plays.png` (local, not in git)
- Network: GET /api/downloads before: 9 items; after: 8 (ids 2, 3, 7, 8, 9, 10, 12, 13).
- Console: `[Framing] stuck with no video: project=6 missing=videoUrl`; 410 on /api/clips/projects/6/clips/6/playback-url.
- Server log: not pulled.

## Solution

Opening a finished highlight in Frame, without sharpening it again, leaves it finished and in Highlights.

## Relevant Files

Not investigated. Related: T16530 (redo from the Finished screen), T17070.

## Acceptance Criteria

- [ ] C1: At 1440x900, opening a finished highlight with "Edit highlight" and leaving without changes keeps the Highlights and Plays counts and the highlight's share status unchanged.
- [ ] C2: The same for a highlight whose game has expired.
