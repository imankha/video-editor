# T13964: Shard backend pytest across 4 parallel CI jobs

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-10-30
**Updated:** 2026-10-30

## Problem

The backend job is the critical path of every Branch CI run that includes it: ~9.2 min, of which
pytest is ~470 s (431 files, 4,659 tests, no single hot spot: top 10 files = 31%). Data and
direction: [ci-pr-speed-design-2026-10-30.md](../ci-pr-speed-design-2026-10-30.md).

## Solution

Run the backend pytest step as a 4-way matrix in BOTH Branch CI and Master CI:
1. A committed duration file (`src/backend/tests/.test_durations.json`, per test FILE, seconds)
   and a small splitter (`scripts/split_pytest.py`) that assigns whole test files to N shards by
   greedy longest-first bin packing; files missing from the duration file get the median.
   Whole files only, so module-scoped fixtures and per-module caches behave as today.
2. Each shard job runs the same setup (checkout, Postgres service, ffmpeg, deps) and
   `pytest <its files>` with the existing deselects. The ruff gate and import check run once, in
   a separate cheap job, not in every shard.
3. `ci-ready` (Branch CI) and Master CI's required checks depend on all shards; a missing or
   skipped shard is a failure, not a pass.
4. Master CI uploads a fresh duration file as an artifact so it can be refreshed when it drifts
   (manual commit is fine; no auto-commit).
5. Test: the splitter is deterministic, covers every `tests/test_*.py` exactly once (union of
   shards = full file list, no duplicates), and balances within 20% on the committed durations.

If T13968 has not landed yet, keep the testmon selection working per shard or run it in one job
only; do not break it silently.

## Context

### Relevant Files (REQUIRED)
- `.github/workflows/branch-ci.yml`, `.github/workflows/master-ci.yml` - backend job -> matrix
- new `scripts/split_pytest.py`, new `scripts/test_split_pytest.py` (add to `SCRIPT_TESTS` and both tooling jobs)
- new `src/backend/tests/.test_durations.json`
- `scripts/ci_policy.py` - routing for the new files; `ci-ready` job list
- `CLAUDE.md` (Test Scope Policy), `.claude/skills/run-tests/SKILL.md` if they describe the backend job shape

### Related Tasks
- T13965 (cheaper `pg_conn`), T13968 (retire testmon selection)

## Acceptance Criteria

- [ ] Branch CI and Master CI run backend pytest as 4 shards; every test file runs exactly once
- [ ] `ci-ready` fails if any shard fails, is cancelled or is missing
- [ ] Backend wall time on a backend-touching PR drops from ~9.2 min to <= 4 min (measure on the PR itself and one follow-up PR)
