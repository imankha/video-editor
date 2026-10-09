# T12330: Branch CI reuses a passing layer result when a push doesn't touch that layer

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-10-09
**Updated:** 2026-10-09

## Problem

Branch CI decides which layers to test from the whole branch diff against master
(`scripts/ci_policy.py route --base master --head HEAD`). So once a branch touches
a layer, every later push reruns that layer's full suite, even when the new commit
changes nothing the suite exercises.

Seen on PR #582 (T12100, 2026-10-09). The frontend suite passed on `f2b60244f`.
The next commit only untracked `qa/` evidence files, but the full frontend suite
(about 5 minutes) ran again. The user's rule (CLAUDE.md Test Scope Policy, 2026-10-09):
never re-run a test whose result is already known. Local runs follow it; CI doesn't.

## Solution

When routing a push, for each layer the branch touches:

1. Find the newest ancestor commit on the branch whose Branch CI run has a
   **successful job for that layer**.
2. If the diff from that commit to the new head touches nothing that routes to that
   layer (the same path classifier `route` already uses, including the
   "unknown shared path runs both layers" rule), mark the layer **reused** instead
   of running it. Record the run id, job id and source SHA in the routing manifest.
3. `ci_policy.py aggregate` (the `ci-ready` gate) accepts a reused layer only with
   that receipt, and only if the source SHA is an ancestor of head.

Master CI keeps its full post-merge sweep, so a missed interaction still gets caught
on master.

## Context

### Relevant Files (REQUIRED)
- `scripts/ci_policy.py` - `route` (layer selection) and `aggregate` (`ci-ready`)
- `scripts/test_ci_policy.py` - policy tests
- `.github/workflows/branch-ci.yml` - layer job `if:` conditions; needs `actions: read` to look up earlier runs
- `scripts/landing_gate.py` - currently requires CI for the exact final revision; must accept a reuse receipt or the gate will refuse every reused landing
- `scripts/test_landing_gate.py`
- `.claude/skills/run-tests/SKILL.md`, `CLAUDE.md` (Test Scope Policy) - document the reuse rule

### Related Tasks
- Follows the 2026-10-09 "never re-run a known result" policy (commit `c29effdc9`)

### Technical Notes
- The exact-revision CI requirement in the Landing Policy is deliberate. A reuse
  receipt has to be at least as strong: same layer, source SHA is an ancestor of head,
  and no routed path changed between the two. Get the user's sign-off on that
  wording before changing `landing_gate.py`.
- Rebases change every SHA, so a rebased branch finds no green ancestor and runs
  in full. That's correct and needs no special handling.
- Never reuse across a change to the layer's dependency manifests
  (`package-lock.json`, `requirements*.txt`) or to the CI workflow itself.
- A reused layer must show up as visibly reused in the Actions UI (a short job that
  prints the receipt), not as an unexplained skip. `ci-ready` currently treats
  unexpected skips as failures.

## Implementation

### Steps
1. [ ] Characterization tests for current `route`/`aggregate` behavior
2. [ ] Failing tests: a docs-only or evidence-only commit on top of a green layer is reused; a commit touching that layer is not; a non-ancestor source is refused
3. [ ] Implement reuse lookup + receipt in `route`, acceptance in `aggregate`
4. [ ] Wire `branch-ci.yml`; extend `landing_gate.py` for receipts (after user sign-off)
5. [ ] Update run-tests skill + CLAUDE.md

### Progress Log

**2026-10-09**: Filed at the user's request after PR #582 reran the frontend suite for an evidence-only commit.

## Acceptance Criteria

- [ ] A push that only changes non-layer files (docs, `qa/`, instructions) on top of a green layer run does not rerun that layer, and `ci-ready` is green with a receipt
- [ ] A push touching the layer, its dependency manifests, or the CI workflow runs the layer in full
- [ ] `landing_gate.py` accepts a valid receipt and refuses a forged or non-ancestor one
- [ ] `scripts/test_ci_policy.py` and `scripts/test_landing_gate.py` pass
