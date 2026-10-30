# T13967: Frontend selection: static assets and cross-tree data files stop forcing the full vitest suite

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-10-30
**Updated:** 2026-10-30

## Problem

T13950's `vitest_selection` (`scripts/ci_policy.py`) forces the full vitest suite for any
frontend-routed path outside the module graph. On recent PRs that happened 3 times without need:
`src/frontend/public/*.png` (#672, #668) and `src/backend/app/pricing.json` (#673). Data: [ci-pr-speed-design-2026-10-30.md](../ci-pr-speed-design-2026-10-30.md).

## Solution

1. Static assets under `src/frontend/public/` (images, icons, fonts): no vitest run for them,
   unless a test reads the asset at runtime (`runtime_read_tests` and its `RUNTIME_READ` pattern
   already find such tests; extend it to name the asset path if needed). Lint/build still run.
2. Cross-tree data files routed to frontend (`CROSS_TREE_READS` / `FRONTEND_TOOLS` entries such as
   `pricing.json`): run only the tests that read that file (grep the test sources for the file's
   basename or path), plus the related set of any other changed files. If no test reads it,
   nothing is selected for it.
3. Everything else that forces full today (config, lockfile, setup files, workflows,
   `.gitattributes`, deleted modules) keeps forcing full.
4. Pin each case in `scripts/test_ci_vitest_selection.py`, including replays of the #672, #668 and
   #673 file lists.

## Context

### Relevant Files (REQUIRED)
- `scripts/ci_policy.py` - `vitest_selection`, `runtime_read_tests`, `RUNTIME_READ`
- `scripts/test_ci_vitest_selection.py`
- `.github/workflows/branch-ci.yml` - only if the step's inputs change

### Related Tasks
- T13950 (introduced the selection), T13966

## Acceptance Criteria

- [ ] A PR changing only `src/frontend/public/*.png` runs no vitest tests (lint/build still run)
- [ ] A PR changing only `src/backend/app/pricing.json` runs only the tests that read it
- [ ] Config, lockfile, setup, workflow and deleted-module changes still force the full suite
