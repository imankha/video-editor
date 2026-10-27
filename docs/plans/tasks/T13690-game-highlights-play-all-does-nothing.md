# T13690: "Play all" on a game's Game Highlights row does nothing, and the row says 0s

**Status:** WIP
**Impact:** 4
**Complexity:** 2
**Tier:** S/M (frontend Finished tab)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 3, 2026-10-26, 1024x768 and 1440x900. Screenshot `.playwright-mcp/p3-1024-gamehl.png`.

## Problem

Under "Vs Carlsbad QA" on the Finished tab, the "Game Highlights" row reads "3 highlights · 0s" and its Play all button (aria-label "Play all") does nothing when clicked: no player opens, no request, no console error. The Top Plays row's Play all works (opens a 24.7 s reel).

## Repro steps

1. Home > Finished, expand "Vs Carlsbad QA".
2. Click Play all on the "Game Highlights" row. Wait 5 s.

**Expected:** the game's highlights play back to back (or, if the reel is still locked, the button is hidden/disabled with the unlock reason); duration shows the real total.
**Actual (before fix):** nothing happens; "0s".

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro; a test that Play all on a game collection opens the player (or is disabled when locked) fails.
2. **After the fix:** same game: plays (or clearly disabled), correct duration.

## Acceptance Criteria

- [ ] Play all works or is visibly disabled with a reason; duration correct
- [ ] Test fails before, passes after
