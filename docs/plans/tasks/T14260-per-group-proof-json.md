# T14260: Stop committing qa/proof.json so /dotask group PRs stop conflicting

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Tier:** S
**Created:** 2026-11-01
**Updated:** 2026-11-01

Found while landing g-t14150-5 (PR #689, 2026-11-01).

## Problem

Every /dotask worker writes its evidence to one tracked file, `qa/proof.json`, replacing the
previous group's content. So once one group's PR merges, every other open group PR conflicts on
that file:
- PR #688 merged, and PR #689 then showed CONFLICTING on `qa/proof.json` only.
- Resolving the conflict moves HEAD, which re-runs CI and invalidates land step 1 (the tested HEAD).

The file has no reason to be in git:
- `qa/` is gitignored (`.gitignore`), and `check_doc_drift.py` already treats the file as a
  runtime artifact.
- `scripts/dotask_evidence.py` reads it from the checkout on disk, and `land --after-test`
  archives it into the evidence directory.
- It was tracked only because workers force-added it, first in T13020.

## Solution

(Rescoped 2026-11-01. The original plan was one evidence file per group. Untracking the file
solves the conflict with less change, and deleting it before the merge would move HEAD.)
1. `git rm --cached qa/proof.json` on master.
2. `scripts/dotask_preland_check.sh` (check 2) refuses a branch that adds or modifies
   `qa/proof.json` or `src/frontend/qa/proof.json`, naming the path. Deleting it is allowed.
3. The kickoff template and the spawn-worker skill tell workers the file stays local and must
   never be added with `git add -f`.

Groups already in flight: if a branch committed the file, merging master gives a modify/delete
conflict. Resolve it with `git rm qa/proof.json`, which keeps the working copy, then re-create
the file from the evidence if needed.

Out of scope: the other evidence logs force-added under `qa/`. They have unique names, so they
never conflict.

## Context

### Relevant Files (REQUIRED)
- `scripts/dotask_preland_check.sh` - check 2 refuses a tracked proof.json
- `scripts/test_dotask_cli.py` - `PrelandCheckTest`
- `scripts/dotask_kickoff_template.md` - worker instruction
- `.claude/skills/spawn-worker/SKILL.md` - proof.json schema section
- `qa/proof.json` - untracked

### Related Tasks
- Related: T13840 (dotask PUSHREADY hygiene)

## Acceptance Criteria

- [x] `qa/proof.json` is no longer tracked on master
- [x] The preland check fails on a branch that commits `qa/proof.json` or `src/frontend/qa/proof.json`, naming the path (red before, green after: `test_committed_proof_json_fails_naming_the_path`)
- [x] A branch that untracks it passes (`test_untracking_proof_json_passes`)
- [x] Worker instructions say the file stays local
