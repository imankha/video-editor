# T13966: Vitest: run non-DOM tests in the node environment and tune the worker pool

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-10-30
**Updated:** 2026-10-30

## Problem

The frontend job's vitest step is ~240 s on a full run (400 s cold). In a local full run,
cumulative jsdom environment setup was ~975 s against ~200 s of test time, and `vite.config.js`
sets `environment: 'jsdom'` for all 653 test files. 162 of them never touch the DOM (no
`render(`, `screen.`, `document.`, `window.`, `@testing-library`). Full runs still happen on
about half the frontend PRs (a widely imported module changed). Data: [ci-pr-speed-design-2026-10-30.md](../ci-pr-speed-design-2026-10-30.md).

## Solution

1. Run DOM-free tests in `node`: either a per-file `// @vitest-environment node` header (3 files
   already use the pragma) or a config-level split (vitest `projects` with an include list).
   Pick the one that keeps a new test's environment obvious to its author. Validate each moved
   file passes under `node`; a file that fails stays on jsdom.
2. Measure pool options on the CI runner shape (4 vCPU): `pool: 'threads'` vs `forks`, and
   `maxWorkers`. Keep `isolate: true` (shared module state between files is not acceptable).
3. Record before/after: full-suite time in CI and the `environment` total vitest prints.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/vite.config.js` - `test` block
- the DOM-free `src/frontend/src/**/*.test.*` files (pragma route) or a new vitest projects config
- `.github/workflows/branch-ci.yml`, `.github/workflows/master-ci.yml` only if a flag changes

### Related Tasks
- T13967 (narrower full-run triggers)

## Acceptance Criteria

- [ ] DOM-free tests run under `node`; the full suite still passes
- [ ] Full vitest run in CI is >= 30% faster than the ~240 s baseline (measured on the PR)

## Attempt 1 result (2026-10-31): no gain, dropped

Group g-t13968-3 added `// @vitest-environment node` to 96 DOM-free test files plus a guard test (`test-env.guard.test.js`, with a JSDOM_BY_IMPORT list of 23 files that look DOM-free but need jsdom via imports). Full vitest stayed green (666 files) but was not faster:

- Local, 4 CPUs, warm cache: 198 s -> 195 s (environment setup total 242 s -> 213 s).
- Branch CI (8591033ec) vs Master CI (e5decd678): vitest step 250 s -> 280 s; frontend job 4.5 -> 5.2 min.
- `pool: threads` gave no gain and failed 1 test; `maxWorkers: 6` gave no gain.

The commit was dropped from the group at the user's call (merge only for real speed gains). The cumulative jsdom setup number does not translate into wall time on a 4-vCPU runner, so the next attempt needs a profile of where the wall time actually goes (transform/collect vs environment vs tests, per worker) before choosing a fix; candidates: `isolate: false` for the node-environment files, a shared jsdom setup, or sharding vitest across jobs like T13964 did for pytest.
