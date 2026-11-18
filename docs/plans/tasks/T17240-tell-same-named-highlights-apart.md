# T17240: Tell same-named highlights apart

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

Two highlight reels are both called "My highlights" (one portrait, one landscape), and unnamed plays all default to "Play 1", "Play 2", so in the ranking game both choices read "Play 1". A parent cannot tell them apart without opening them. Done when the parent sees the change described below.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f). The owner agreed in the confusion review (https://claude.ai/artifact/QDjidEXfCW1HuNXby2RYLC, finding U11), and a UX expert review (Fable model, same day) settled the final change below. Screenshots: `qa/qa-pass-2026-11-17/ux/` (local, not in git).

This is a confusion finding the owner agreed to fix, not a breakage, so there are no repro logs.

## Solution

- Reels: "My highlights (portrait)" and "My highlights (landscape)".
- Wherever an unnamed play's name shows, display the game plus time, for example "Vs Oceanside 0:14". Display default only; never write it into the stored name.

## Relevant Files

Names in the Solution come from the UX expert's code read; otherwise not investigated.

## Acceptance Criteria

- [ ] C1: No two reel cards on one profile share a name.
- [ ] C2: An unnamed play shows as game plus time in the list, tiles and ranking game; renaming still works.
