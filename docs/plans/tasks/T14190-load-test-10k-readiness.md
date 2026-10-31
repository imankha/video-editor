# T14190: 10K readiness load test on staging

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Tier:** M
**Created:** 2026-10-31
**Updated:** 2026-10-31

Source: 10K-user readiness audit, 2026-10-31 (expert agent, claims spot-checked in code). Assumed load at 10K registered: ~1,000 daily actives, ~100 concurrent sessions at evening/weekend peak, bursts of concurrent uploads and exports after games.

## Problem

Nothing today proves the app holds 10K users; the audit's numbers are code-reading plus one threadpool simulation. Readiness needs a repeatable measurement, run once now as a baseline and again after the prerequisite tasks.

## Solution

Staging k6 (or Locust) scenario: 100 virtual users replaying a boot burst plus edit actions, with 40 stubbed Modal waits held open; `scripts/concurrency_probe.py` at N=8 on `/api/health`; seed 10K synthetic users/profiles on staging and time `do_sweep`, counting ListObjectsV2 in the T13930 usage shards; record Fly CPU throttle and disk. Synthetic staging data only, cleaned up after.

## Context

### Relevant Files
- `scripts/` (load scenario + seed/cleanup scripts)
- `docs/plans/` (results doc)

### Notes
Load: backend-services.md, persistence-sync.md. Baseline first (no dependencies); the pass run depends on T14100, T14110, T14130, T14140, T14150.

## Acceptance Criteria

- [ ] Baseline results recorded before fixes
- [ ] Pass criteria: `/api/health` p95 < 200 ms and no authenticated request > 1 s under the scenario; CPU throttle 0; sweep runtime and Class A per run independent of user count
- [ ] Seed data removed from staging after the run
