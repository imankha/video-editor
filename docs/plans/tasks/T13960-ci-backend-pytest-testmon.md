# T13960: Branch CI backend job selects tests by recorded coverage (pytest-testmon)

**Status:** WIP
**Impact:** 7
**Complexity:** 6
**Created:** 2026-10-29
**Updated:** 2026-10-29

## Problem

Branch CI's backend job runs the whole pytest suite (`python -m pytest tests/test_*.py`,
`.github/workflows/branch-ci.yml` backend job) for any `src/backend/**` change. The user wants
only the tests reachable from the change. Choosing tests by file path is unsound in this codebase:
nearly every test imports `app.main`, so a `storage.py` change is exercised by tests that never
mention storage (reason per-file selection was rejected on 2026-08-03, T6405). Sound selection
needs runtime coverage data.

## Solution

Adopt `pytest-testmon`:
1. Master CI runs the full suite with `--testmon` and saves `.testmondata` as a cache/artifact
   keyed to the master SHA.
2. Branch CI restores the latest master `.testmondata`, then runs `pytest --testmon` (plus the
   same deselects), so only tests whose recorded coverage touches changed code run.
3. Fallback to the full suite (bias toward RUNNING) when: no usable baseline exists; the
   baseline SHA is not an ancestor of the branch base; dependencies changed
   (`requirements*.txt`, `pyproject`, `conftest.py`, pytest config); a migration or
   `_SCHEMA_DDL` changed; or a non-Python input the tests read at runtime changed (see
   `CROSS_TREE_READS` in `scripts/ci_policy.py`, `formal annotations/test.short/`).
4. Lint, ruff baseline, and the `from app.main import app` import check stay full.

## Context

### Relevant Files (REQUIRED)
- `.github/workflows/branch-ci.yml`, `.github/workflows/master-ci.yml` - pytest steps, cache save/restore
- `src/backend/requirements*.txt` - add pytest-testmon
- `src/backend/run_tests.py` - keep the canonical selection in sync
- `scripts/ci_policy.py`, `scripts/test_ci_policy.py` - emit the full-suite fallback flag
- `docs/testing/known-failures.md` - deselects must still apply
- `CLAUDE.md` (Test Scope Policy), `.claude/skills/run-tests/SKILL.md`

### Related Tasks
- Sibling: T13950 (frontend vitest related), T13970 (router fan-out)
- `pytest tests/` capture crash is tracked in T5000; testmon must work with `--capture=sys`

### Technical Notes
- testmon tracks Python line coverage. It does NOT see data files, env vars, Postgres/SQLite
  schema state, or subprocess-executed scripts (`scripts/delete_user.py` etc.). Every such
  input needs an explicit full-run trigger.
- Check the cost of the coverage-instrumented run on master (expect +20-40% time) and the cache size.
- Measure on recent backend PRs: selected vs full, and replay any Master CI post-merge
  failure to confirm testmon would have selected it.

## Acceptance Criteria

- [ ] Master CI publishes a testmon baseline per merge
- [ ] A backend change in Branch CI runs only the testmon-selected tests; the log lists them
- [ ] Every fallback trigger above forces a full run, covered by `test_ci_policy.py`
- [ ] Replaying a past Master-CI-only regression shows it would be selected
- [ ] Docs updated
