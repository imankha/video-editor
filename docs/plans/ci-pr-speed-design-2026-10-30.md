# Faster PR CI: design from historical data (2026-10-30)

Goal (user, 2026-10-30): cut Branch CI wall time on PRs, starting from the idea of not running
tests that are irrelevant to the diff. This doc measures where the time goes on recently merged
PRs, tests the diff-selection idea against them, and sets the direction. Tasks: T13964-T13968.

## Data

### Where Branch CI time goes (merged PRs #668-#681)

| PR | Wall (min) | backend job | frontend job |
|---|---|---|---|
| #680 | 8.8 | 8.3 | 4.4 |
| #679 | 9.8 | 9.3 | 4.2 |
| #678 | 10.4 | 10.0 | not run |
| #677 | 9.7 | 9.2 | 7.2 |
| #676 | 9.7 | 9.2 | 4.5 |
| #673 | 8.8 | 8.3 | 7.2 |
| #671 | 9.7 | 9.2 | not run |
| #669 | 7.0 | 6.5 | not run |
| #668 | 9.7 | 9.1 | 5.0 |
| #674, #672, #670 | 5.0, 4.9, 7.7 | not run | 4.6, 4.4, 7.2 |

- Whenever the backend job runs it is the critical path. Inside it, pytest is ~470 s; checkout,
  service containers, ffmpeg and `pip install` together are ~75 s.
- Pytest has no hot spot: 431 files, 4,659 tests, ~426 s. The top 10 files are 31% of the time,
  the top 100 are 82%. About 91 ms per test on average.
- Tests that use the `pg_conn` fixture (78 files, ~1,194 tests) cost 154 ms per test versus
  67 ms for the rest: `pg_conn` runs `_SCHEMA_DDL` and replays the Postgres migrations from v005
  for EVERY test (`src/backend/tests/conftest.py`). That is ~100 s of the 426 s.
- The frontend job is dominated by vitest (~240 s full, 400 s on a cold run). In a local full run,
  cumulative jsdom environment setup was ~975 s against ~200 s of actual test time. 162 of 653
  frontend test files do not touch the DOM.
- The repo is PUBLIC: GitHub Actions minutes are free and the standard Linux runner has 4 vCPUs,
  so parallel jobs cost nothing.

### Does diff-based selection help? Backend: no

Replaying T13962's `pytest_plan` on the 9 merged PRs that ran the backend job (empty import-time
map, the most permissive case): **0 of 9 would have selected; all 9 run the full suite.**
Triggers: module-level code changed (5), workflow / config / requirements changed (3),
non-Python input (`pricing.json`, 1). Our PRs bundle several tasks, so one trigger is almost
always present. T13962's own per-commit measurement was 25%; per PR it is 0%.

A static import graph cannot rescue it: for every one of those PRs, the changed app modules are
reachable from 411 of 433 test files through the tests' own imports, and from all 433 through
`conftest.py`. The backend modules import each other too densely for file-level selection.

### Does diff-based selection help? Frontend: yes, partly

Replaying T13950's `vitest_selection` on the 18 merged PRs that touched frontend paths:
12 would run `related`, 6 run full. Running `vitest related` locally for 11 of the 12:

| PR | changed files | test files selected | local time |
|---|---|---|---|
| #670 | 2 | 6 | 11 s |
| #676 | 4 | 7 | 22 s |
| #650 | 2 | 27 | 16 s |
| #655 | 4 | 38 | 20 s |
| #664 | 11 | 46 | 19 s |
| #658 | 4 | 59 | 21 s |
| #663, #653, #654, #674, #656 | 4-22 | 417-474 (near full) | 95-105 s |

So selection works for small changes (6 of 11 run a few dozen files) and is a no-op when a
widely imported module changes. Of the 6 full runs, 3 were triggered by inputs that do not need a
full run: `public/*.png` assets (#672, #668) and the cross-tree `src/backend/app/pricing.json`
(#673), which only the tests that read it need.

## Direction

1. **Backend: make the full suite fast instead of selecting.** Split pytest across 4 parallel
   jobs, balanced by recorded per-file duration (T13964), and stop replaying migrations per test
   in `pg_conn` (T13965). Expected: backend job ~9.2 min to ~3.5 min; with T13965, ~3 min.
   No selection risk, and Master CI gets the same speedup.
2. **Frontend: keep `vitest related`, make the full run cheaper and the triggers narrower.**
   Run non-DOM tests in the `node` environment and tune the pool (T13966); stop forcing a full
   run for static assets and cross-tree data files (T13967).
3. **Retire backend testmon selection** (T13968, recommended, user to confirm). It saved nothing
   on 9 of 9 PRs, adds a coverage-instrumented Master CI run plus three helper scripts, and its
   residual risk is a Branch CI that skips a test. Sharding makes the full suite cheap enough
   that selection is not worth that risk.

Expected PR wall time once 1 and 2 land: ~4-5 min for a PR that touches backend (from ~9-10),
with small frontend-only changes at ~2-3 min.

## How to re-measure

Re-run these before and after each task:
- per-job and per-step durations: GitHub API `actions/runs?head_sha=` then `/jobs`
- per-file pytest durations: GitHub log timestamps on each `tests/test_x.py ....` line
- backend selection replay: `ci_policy.pytest_plan(root, merge_base, head, merge_base, {}, [])`
- frontend selection replay: `ci_policy.vitest_selection(paths, set(), runtime_read_tests(...))`,
  then `npx vitest related --run <files>` in `src/frontend`
