# T5990: ProjectManager's GameCard/GameMetaRow is superseded by GameTile but still tested, which masked real drift

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-07-26
**Found by:** the 2026-07-26 full staging E2E sweep (while fixing T5675)

## What is wrong

T5681's poster grid replaced the Games-tab game LIST with a compact poster tile.
`ProjectManager.jsx:881` renders `<GameTile ...>`. The older `GameCard` (exported,
~`ProjectManager.jsx:1451`) and its `GameMetaRow` (~`:1416`) / `RatingChip` helpers appear to
be **no longer mounted anywhere**:

```
grep -rn "GameCard" src/ --include=*.jsx --include=*.js
  -> only ProjectManager.jsx itself, two COMMENTS (GameTile.jsx:26, gamesDataStore.js:377),
     and its own test files
```

**Why this is worth a task and not just dead code:** its Vitest specs still render it
DIRECTLY and still pass, so they report green for a surface no user can reach — and that
false signal actively misled a live spec. `T5675-home-hero-legibility.spec.js` asserted
`getByText(/Uploaded/)`, `Footage quality N/100` and the rating chips on the Games home;
those strings live in `GameMetaRow`, not in the tile that actually renders, so the E2E failed
while `ProjectManager.metaLegibility.test.jsx` stayed green. (T5675 was retargeted onto the
tile on 2026-07-26 — that part is done; this task is about the dead component underneath.)

## What to do

1. **Confirm it really is dead before deleting anything.** Check for dynamic/lazy use, any
   route that still renders the list, mobile/desktop branches, and feature flags. If it IS
   still reachable on some path, this task becomes "re-point or document", not "delete".
2. If dead: remove `GameCard`, `GameMetaRow`, `RatingChip` (only if not shared) and the
   now-unused imports, plus the test files that only exist to cover them:
   - `src/components/ProjectManager.gameCard.test.jsx`
   - `src/components/ProjectManager.metaLegibility.test.jsx`
   - keep anything that also covers still-live behaviour (check
     `ProjectManager.publishRetry.test.jsx` — it covers ProjectCard publish/sync, which IS live).
3. **Do not silently drop a real guarantee.** For each assertion in the deleted tests, state
   whether the behaviour still exists on `GameTile` and is covered there
   (e.g. `GameTile.posterUrl.test.jsx`, `T5681-games-poster-grid.spec.js`) or is genuinely gone
   with the old surface. Anything still-live and now-uncovered gets a replacement test on the
   tile — that is the point of the task.
4. Fix the two stale comments that still reference GameCard.

## Watch out for

- `ProjectManager.jsx` is large and hot; this is code REMOVAL only. Per CLAUDE.md refactoring
  rules, keep it a mechanical commit — no behaviour change mixed in.
- Frontend unit suite baseline before you start: **141 files / 1398 tests pass** (2026-07-26).
  Deleting the two test files will lower the counts legitimately; report the new numbers and
  which assertions were re-homed vs retired.

## Acceptance criteria

1. Evidence that GameCard is (or is not) reachable — a grep + a reasoning note, not an assumption.
2. If dead: removed, with a per-assertion disposition table (re-homed / retired-with-the-surface).
3. Frontend unit suite green, with before/after counts stated.
4. `npm run test:e2e -- e2e/T5681-games-poster-grid.spec.js` still green (the tile is the
   surviving surface).
