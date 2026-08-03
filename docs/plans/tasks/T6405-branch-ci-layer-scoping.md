# T6405: Branch CI runs both layers on every push, including the one the diff cannot reach

**Status:** WAITING ON USER
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-03
**Updated:** 2026-08-03

## Problem

**User direction 2026-08-03**, while reviewing T6400: *"only run ci tests that may have actually
been effected by the code change and not all tests."*

`branch-ci.yml` runs BOTH jobs unconditionally on every push to `feature/**`, `integration/**`,
`fix/**`:
- frontend: `npm ci` + 4 lint/architecture gates + `npx vitest run --retry=2` (full suite)
- backend: postgres service + ffmpeg + `pip install` + ruff gates + `pytest tests/test_*.py` (full suite)

T6400's diff touched `src/backend/**` and docs only, yet the entire frontend job ran — install,
ESLint, viewport-unit gate, media-api-base gate and ~1,400 vitest tests, none of which a
backend-only change can break. Measured: the T6400 run took 5m07s with both jobs.

## Solution

A `changes` job diffs against master and gates the two existing jobs on its outputs.

| diff touches | frontend job | backend job |
|---|---|---|
| `src/backend/**` only | skipped | runs (full) |
| `src/frontend/**` only | runs (full) | skipped |
| `scripts/**` (shared gate scripts) | runs (full) | skipped |
| `.github/workflows/branch-ci.yml` | runs (full) | runs (full) |
| docs / `.claude/` / `src/landing/**` only | skipped | skipped |

**JOB-level only. Within a job the suite still runs IN FULL.**

**Per-test-file selection was asked for, considered, and rejected.** Python's import graph
means a `storage.py` change is exercised by tests that never name storage — anything importing
`app.main` (`test_session_pinning`, `test_background_sync`, `test_export_worker_sync`,
`test_t4050_durable_sync`, ...). Matching test filenames against the diff would silently skip
real regressions and defer them to Master CI, i.e. discover them AFTER merge. Sound intra-suite
selection needs coverage data (`pytest-testmon` or equivalent), not path matching; that is a
separate, larger task if ever wanted.

Design rules:
- **Bias toward running.** Anything shared trips both layers. A missed run is a silent
  regression; a redundant run costs only wall-clock.
- `scripts/**` counts as frontend because the frontend job runs `check-viewport-units.mjs` and
  `check-media-api-base.mjs` from there.
- A change to `branch-ci.yml` itself runs both layers, so the workflow always re-validates
  itself.
- Master CI (`master-ci.yml`) is UNCHANGED — it still runs the complete suites on every merge to
  master, so the full sweep is never skipped, only relocated for layers a branch cannot reach.
- Safe because master has **no branch protection** (`gh api .../branches/master/protection` →
  404), so a skipped job cannot wedge a required status check. **If branch protection is ever
  added, re-verify** that skipped jobs satisfy the required checks.

## Context

### Relevant Files (REQUIRED)
- `.github/workflows/branch-ci.yml` - the `changes` job + two `needs`/`if` gates
- `CLAUDE.md` - "Test Scope Policy" said Branch CI "runs the complete vitest+pytest suites on
  every push"; that sentence becomes false with this change and is updated in the same commit
- `.github/workflows/master-ci.yml` - deliberately untouched (the full sweep)

### Related Tasks
- Triggered while reviewing T6400 (backend-only diff that paid for the full frontend job)
- Policy origin: the changed-code test-scope rule in CLAUDE.md

### Technical Notes
The filter reuses the `git diff --name-only origin/master...HEAD` pattern the ESLint and Ruff
"changed files vs master" steps already use, so there is no new third-party action
(`dorny/paths-filter` was not needed) and no new failure mode. `fetch-depth: 0` is already set
on every checkout.

## Implementation

### Steps
1. [x] Add the `changes` job with `frontend` / `backend` outputs
2. [x] Gate both existing jobs on it (`needs` + `if`)
3. [x] Verify the filter against synthetic AND real branch diffs
4. [x] Update CLAUDE.md's Test Scope Policy wording
5. [x] Confirm no branch protection depends on the skipped checks

## Acceptance Criteria

- [x] A backend-only diff skips the frontend job entirely
- [x] A frontend-only diff skips the backend job entirely
- [x] A `branch-ci.yml` change runs both layers
- [x] Each job that DOES run still executes its full suite (no intra-suite selection)
- [x] Master CI unchanged
- [x] CLAUDE.md no longer claims Branch CI runs both suites on every push
- [ ] Observed on a real push: this branch runs BOTH jobs (it edits the workflow); the next
      backend-only branch shows the frontend job skipped
