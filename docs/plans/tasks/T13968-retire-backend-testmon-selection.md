# T13968: Retire backend testmon selection and the Master CI baseline

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-10-30
**Updated:** 2026-10-30

## Problem

T13961/T13962/T13963 built a testmon baseline in Master CI and file-level backend test selection
in Branch CI. Replayed on the 9 most recent merged PRs that ran the backend job, it would have
selected on **0 of 9** (all full: module-level code, workflow/config/requirements, or non-Python
input changes), and a static import graph reaches 411-433 of 433 test files for every one of
them. It costs a coverage-instrumented Master CI run plus an import-time recording step, three
helper scripts and their tests, and its only possible payoff is a Branch CI that skips tests,
with Master CI as the sole backstop. Data: [ci-pr-speed-design-2026-10-30.md](../ci-pr-speed-design-2026-10-30.md).

**Recommendation, needs user confirmation before starting** (the user asked for diff-based
selection; this removes it for the backend only, and T13964 makes the full backend suite fast
instead). Start after T13964 lands so Branch CI is fast before selection goes away.

## Solution

1. Branch CI backend: always run the full suite (sharded by T13964); remove the baseline
   restore and `pytest_plan` step.
2. Master CI backend: drop `--testmon`, the plugin, the import-time recording and the cache save.
3. Delete `scripts/testmon_baseline_plugin.py`, `scripts/testmon_import_lines.py`,
   `pytest_plan` and its helpers in `scripts/ci_policy.py`, their tests, and
   `pytest-testmon` from `src/backend/requirements.test.txt` / `testmon_*` settings in
   `src/backend/pytest.ini`. Grep `src/`, `e2e/`, `scripts/` and `.github/` for every removed name
   first (CLAUDE.md refactoring rule 7).
4. Update `CLAUDE.md` Test Scope Policy and `.claude/skills/run-tests/SKILL.md` back to "backend
   runs its complete suite", and note the outcome in T13961/T13962.
5. Delete the `testmon-*` cache entries (`gh cache delete`).

## Context

### Relevant Files (REQUIRED)
- `.github/workflows/branch-ci.yml`, `.github/workflows/master-ci.yml`
- `scripts/ci_policy.py`, `scripts/testmon_baseline_plugin.py`, `scripts/testmon_import_lines.py`
- `scripts/test_ci_testmon_selection.py`, `scripts/test_testmon_baseline.py`
- `src/backend/requirements.test.txt`, `src/backend/pytest.ini`
- `CLAUDE.md`, `.claude/skills/run-tests/SKILL.md`

### Related Tasks
- Reverts T13961, T13962, T13963. Depends on T13964.

## Acceptance Criteria

- [ ] Branch CI and Master CI backend run the full (sharded) suite with no testmon
- [ ] No remaining references to the removed scripts, `pytest_plan` or `pytest-testmon` in `src/`, `e2e/`, `scripts/`, `.github/`, `CLAUDE.md`, `.claude/`
- [ ] Doc drift and tooling checks pass
