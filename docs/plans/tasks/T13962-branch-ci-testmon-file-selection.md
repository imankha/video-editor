# T13962: Branch CI selects whole backend test files from the testmon baseline

**Status:** WIP
**Impact:** 4
**Complexity:** 5
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

Branch CI's backend job runs the full pytest suite for every backend change. T13960
showed that per-test testmon selection misses real dependencies, and that even with
conservative fallbacks only about 25% of backend commits (20 of the last 80) would get a
selection at all.

## Solution

Using T13961's baseline:
1. Restore the newest `testmon-*` baseline B with `git merge-base --is-ancestor B HEAD`
   (and B an ancestor of the branch base); none -> full suite.
2. Compute every full-suite trigger from the two-dot `git diff B HEAD` (testmon compares
   B's files to the checkout, master drift included): non-Python inputs, conftest,
   migrations, `pg.py`/`user_db.py`/`database.py`, deleted modules, and any changed
   function body that overlaps T13961's import-time lines or whose skeleton changed
   (bodies of `lru_cache`/`cache`/`cached_property` functions count as skeleton).
3. Otherwise use testmon only as a selector:
   `pytest --testmon --testmon-nocollect --collect-only -q tests/test_*.py`, take the unique
   test FILES, then run plain pytest once on those files plus `always_run.json`. Whole
   files cover module-scoped fixtures and per-module caches. List the files in the log.
4. Warn (`::warning::`) when testmon reports an environment change ("All tests have to
   be re-executed").

**Design gate (WIP before implementing):** this makes Branch CI's backend
verdict selective, with Master CI as the only backstop for the residual risk in
T13961. The user must accept that and the CLAUDE.md Test Scope Policy wording change.
Re-measure the selection rate on recent commits first; if it is still about 25%, the
saving may not be worth the risk.

## Context

### Relevant Files (REQUIRED)
- `.github/workflows/branch-ci.yml` - backend job
- `scripts/ci_policy.py`, a new `scripts/test_ci_testmon_selection.py`
- `CLAUDE.md` (Test Scope Policy), `.claude/skills/run-tests/SKILL.md`, `docs/testing/known-failures.md`
- `docs/plans/tasks/T13960-testmon-prototype.patch.gz` - reverted prototype (`pytest_plan`, skeleton rule, workflow wiring)

### Related Tasks
- Depends on: T13961
- Follows: T13960, T13950 (same manifest/selection pattern for vitest)

## Acceptance Criteria

- [x] A body-only backend change runs only the selected test files plus always-run; the log lists them
- [x] Every fallback trigger forces a full run, covered by tests
- [x] Replaying `b1f1dd20` (fixed by `d4e70cc21`) still runs the regressed test
- [x] Docs updated

## Outcome (2026-10-30)

User approved the design gate (selective backend verdict, Test Scope Policy wording) after being told the
selection rate may stay near 25%. Re-measure (36 backend first-parent commits of the last 300, empty
import-time map = upper bound): 9 select (25%). Selection is by whole test file (`testmon` as selector,
then plain pytest on those files + `always_run.json`); full-suite triggers: any non-Python input, conftest,
migrations, `pg.py`/`user_db.py`/`database.py`, deleted module, skeleton change, a changed body that overlaps
an `import_lines.json` line, a cached (`lru_cache`/`cache`/`cached_property`) body, or a baseline missing any
of its three files. Replay of `b1f1dd20` plans the full suite (new module + migration), so the regressed test
runs. Not exercised locally: the workflow's restore/collect step (needs a Master CI baseline; first Branch CI
run after Master CI saves one is the real check) and a real `import_lines.json` (no torch locally).

**Correction (T13963):** `import_lines.json` now has the shape `{"lines": ..., "unimportable": ...}`.
`pytest_plan` plans the full suite for any changed or deleted path in `unimportable` (its import-time lines
are unknown) and for an old flat-shape file. The "no torch locally" gap above is what caused the red Master CI.
