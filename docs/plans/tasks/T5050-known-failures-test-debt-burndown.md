# T5050: Burn down the three test-debt rows in known-failures.md

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-07-13
**Updated:** 2026-07-13

## Problem

`docs/testing/known-failures.md` carries three rows that are pure test-layer
debt (zero user impact) with no burn-down task, violating the doc's own rule 2
("Every entry is debt: each should eventually become a task"). Two are
deselected in CI, so they are invisible until someone runs them deliberately.

| Row | Failure | Root cause |
|-----|---------|-----------|
| `test_shared_game_extension.py::TestStorageStatusDerivation` (4 pg-backed cases) | `RuntimeError: No user context set` in fixture setup | Class fixture never calls `set_current_user_id()` in a bare pytest run; **deselected in CI**, which also skips its 2 PASSING pure cases |
| `profileStore` switchProfile timeout (frontend) | Intermittent timeout under full-suite load; passes in isolation | Race in the test; CI absorbs it with `vitest --retry=2` |
| `test_tutorial_quest_steps.py::test_definitions_endpoint_tutorial_step_first` | Fails full-suite, passes in isolation | Test-order pollution: a prior test mutates shared state (quest definitions/app state); **deselected in CI** (added 2026-07-13, run 29273804525) |

## Solution

Fix each at its root, then DELETE its row and remove its CI deselect (the doc's
rule 3: deselect list stays in sync). One branch, three small commits.

1. **test_shared_game_extension**: add `set_current_user_id(...)` (+ profile
   context if needed) in the class fixture, mirroring how other pg-backed test
   classes do it (grep `set_current_user_id` in tests/ for the pattern). Then
   un-deselect in `branch-ci.yml` — this RESTORES the 2 passing pure cases +
   4 real cases to CI coverage.
2. **profileStore switchProfile**: find the race (likely a missing `await`/
   `waitFor` on the store's async switch, or fake timers vs real timers under
   load). Fix the TEST, not the store — unless reading it reveals a real store
   race, in which case STOP and file a product task instead of patching.
   Keep `--retry=2` in CI (it guards other flakes) but this test must pass
   50/50 in a loop locally (`npx vitest run <file> --repeat` or a shell loop).
3. **tutorial_quest_steps order pollution**: run the file after the full suite
   locally to reproduce, bisect which earlier test leaks state
   (`pytest tests/test_a.py tests/test_tutorial_quest_steps.py` pair-wise, or
   `-p no:randomly` variants), then isolate: reset the leaked state in this
   test's fixture (reset fixture, not a defensive re-read in product code).
   Un-deselect in CI.

## Context

### Relevant Files (REQUIRED)
- `docs/testing/known-failures.md` — the three rows (delete when fixed)
- `.github/workflows/branch-ci.yml` — two `--deselect` entries to remove
- `src/backend/tests/test_shared_game_extension.py` — fixture fix
- `src/backend/tests/test_tutorial_quest_steps.py` — isolation fixture
- `src/frontend/src/stores/profileStore.test.js` (or wherever the switchProfile
  test lives — grep `switchProfile`) — race fix

### Related Tasks
- T5000 (container test-env hygiene) — sibling doc-hygiene task; no file overlap
  except known-failures.md (coordinate if run in the same wave)
- T5020 (landed) — created the deselect entries this task removes

### Technical Notes
- Backend tests ONLY against a throwaway Postgres (tests truncate shared
  tables): `docker run -d --name tmp-pg -e POSTGRES_PASSWORD=x -p 5433:5432
  postgres:16` then `DATABASE_URL=postgresql://postgres:x@host.docker.internal:5433/postgres`.
  The `pg_conn` fixture now handles fresh DBs (schema-first, T5020).
- Acceptance for each fix is the FULL relevant suite, not the file alone —
  order pollution and load flakes only show under full-suite conditions.

## Implementation

### Steps
1. [ ] Fix + un-deselect test_shared_game_extension; full backend suite green.
2. [ ] Fix profileStore test; 50-iteration local loop green; full vitest green.
3. [ ] Fix + un-deselect tutorial_quest_steps; full backend suite green.
4. [ ] Delete the three known-failures rows; confirm deselect list matches doc.
5. [ ] CI verdict green on the branch.

## Acceptance Criteria

- [ ] All three tests pass under FULL-suite conditions (not just isolation)
- [ ] known-failures.md no longer lists them; CI deselects removed
- [ ] test_shared_game_extension's 6 cases all run in CI again
- [ ] No product-code changes (if a real product race is found, STOP and file it)
