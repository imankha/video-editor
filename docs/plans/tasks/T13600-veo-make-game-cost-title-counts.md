# T13600: Veo "Make a game": no cost shown, game title differs from the promised one, chip counts and names are off

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Tier:** M (frontend Veo import)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, 1440x900 (report bugs 41, 42, 44, 46; screenshots `BUG-41-veo-picker-no-cost-1440.png`, `BUG-42-veo-title-changed-1440.png`, `p2-veo-attack-1440.png`). Zip: `Veo highlights WCFC vs. LA Breakers FC Long Beach.zip`.

## Problem and repro steps

Steps: Home > Upload game > choose the LA Breakers Veo zip > "Make a game from these highlights" > tap the Goal chip, tick Goal; tap Attack, tick the Attack row > "Create game from 2 highlights".

- **A. Cost not shown (bug 41).** No credit cost anywhere in the picker or on the create button; 2 credits were charged (171 -> 169). Expected: cost and balance shown before creating, like the normal upload dialog.
- **B. Title changes (bug 42).** Picker says "Game title: Vs LA Breakers FC Long Beach"; the created game is "WCFC vs. LA Breakers FC Long Beach". Expected: the game gets the title shown.
- **C. Counts and labels (bug 44).** Chips read Goal 1 / Shot on goal 29 / Attack 4 (34) but the list has 30 rows; the Attack filter lists 3 "Shot on goal" rows + 1 "Attack". In the game the Goal suggestion reads 1:12:31 / 25s vs 1:12:29 / 27s in the picker, and a "Shot on goal 1" chip appears with no matching suggestion. The moment list scrolls inside a 3-row window with a nested scrollbar.
- **D. Raw file name (bug 46).** The Videos lane shows "31 0112...- Goal".

## Context

### Relevant Files
- Veo zip picker / make-game flow (search "Make a game from these highlights", "Create game from"), suggested plays panel
- `.claude/knowledge/annotate.md`

## Verify the fix (required, before and after)

1. **Before the fix:** run the steps, record the missing cost, the title mismatch, the chip vs row counts and times; add unit tests for the title and for chip counts = rows shown; see them fail.
2. **After the fix:** run the same zip and choices: cost shown and equal to the charge, title as promised, counts consistent, friendly video name.

## Acceptance Criteria

- [ ] A-D fixed
- [ ] Tests fail before, pass after
