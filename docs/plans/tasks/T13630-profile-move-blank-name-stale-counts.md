# T13630: Moving a highlight between profiles: blank "Default" name, stale ranking counts, wrong-profile poster requests

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** M (frontend profiles + collection summary)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, 1440x900 (report bugs 61, 62, 63, 64; screenshots `BUG-61b-move-list-blank-row-1440.png`, `BUG-61-move-dialog-blank-default-name-1440.png`, `BUG-62-ranking-progress-wrong-after-move-1440.png`). Profiles: Default, QA Second Athlete.

## Problem and repro steps

Steps: Finished tab on Default > ⋮ on a highlight > Move to profile... > QA Second Athlete > Move highlight. Switch to QA Second Athlete > Finished > ⋮ > Move to profile... > (row) > Move highlight. Switch back to Default.

- **A. Blank name (bug 61).** From QA Second Athlete the list shows one row with an icon and no name; confirm reads "Move to ?" and "This highlight moves to and leaves this profile." Guide says "Tap Move to confirm." but the button is "Move highlight". Expected: "Default" by name; guide names the real button.
- **B. Stale counts (bug 62).** Back on Default (4 highlights, 66 s) Ranking Progress says "Locked until you have 30s of highlights. 25s / 30s" (was "Warming up" before the moves). QA Second Athlete with 0 highlights also shows "25s / 30s". Expected: counts follow the highlights.
- **C. Wrong-profile requests (bug 63).** Switching Default -> QA Second Athlete fires 6x `404 /api/games/{id}/poster.jpg?profile_id=<new profile>` for the old profile's games.
- **D. Game stub (bug 64).** QA Second Athlete gets a game "Vs LA Breakers FC Long Beach" tagged "In Default" with 0 plays that stays after the highlight moves back. Decide if it should remain.

## Verify the fix (required, before and after)

1. **Before the fix:** run the steps, record A (screenshot), B (both Ranking texts), C (console 404s), D; write tests for the profile name in the move list and for ranking totals after a move; see them fail.
2. **After the fix:** same steps: Default named, counts correct on both profiles, no 404s on switch, D as decided.

## Acceptance Criteria

- [ ] A-C fixed, D decided
- [ ] Tests fail before, pass after
