# T14260: qa/proof.json conflicts on every /dotask group that lands after another

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** M
**Created:** 2026-11-01
**Updated:** 2026-11-01

Found while landing g-t14150-5 (PR #689, 2026-11-01).

## Problem

Every /dotask worker writes its evidence to one tracked file, `qa/proof.json`, and replaces
the previous group's content. So once one group's PR merges, every other open group PR
conflicts on that file:
- PR #688 merged, and PR #689 then showed CONFLICTING on `qa/proof.json` only.
- Resolving the conflict moves HEAD, which re-runs CI and invalidates land step 1 (the tested HEAD).

The merged file also only ever holds the last group's evidence, so earlier groups' evidence
survives only in their evidence directories.

## Solution

Write evidence to one file per group, named by its slug (`qa/proof/<slug>.json`). Two groups
then never touch the same path.
- Update the readers: `scripts/dotask_evidence.py`, `scripts/dotask_preland_check.sh` (its
  `qa/` allowlist), the kickoff template in `scripts/dotask_cli.py`, and the spawn-worker skill
  (proof.json schema section).
- Keep reading a legacy `qa/proof.json` for groups that are already running.
- Update the `qa/` gitignore exception.

## Context

### Relevant Files (REQUIRED)
- `scripts/dotask_evidence.py` - reads qa/proof.json
- `scripts/dotask_preland_check.sh` - non-evidence files under qa/
- `scripts/dotask_cli.py` - kickoff template names the proof file
- `.claude/skills/spawn-worker/SKILL.md` - proof.json schema
- `.gitignore` - qa/ exception
- `scripts/ci_policy.py` - routing for the new path, if needed

### Related Tasks
- Related: T13840 (dotask PUSHREADY hygiene)

## Acceptance Criteria

- [ ] Two groups started from the same master can both merge, in either order, without a conflict on evidence files
- [ ] `dotask_evidence.py` builds evidence from `qa/proof/<slug>.json`, and still from a legacy `qa/proof.json`
- [ ] The preland check accepts the new path and still rejects other files under `qa/`
- [ ] Harness tests cover both paths
