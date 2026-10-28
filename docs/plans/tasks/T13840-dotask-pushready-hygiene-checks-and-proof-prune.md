# T13840: /dotask: pre-PUSHREADY hygiene checks in the kickoff, and prune `qa/proof.json` so `land --after-test` builds evidence again

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** M (harness: `scripts/dotask_cli.py` kickoff template, `scripts/dotask_evidence.py`, `qa/proof.json`; no app code)
**Created:** 2026-10-28
**Updated:** 2026-10-28
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Problem

On 2026-10-28 two groups (PR #659 g-t13790-2, PR #660 g-t13780-1) reported PUSHREADY and then failed Branch CI four times in total for things visible before the push:

1. A byte-identical copy of a new test committed under `qa/` (`qa/useReEditReel.test.js`): `scripts/ci_policy.py` deliberately fails code-like files under `qa/` (`UnclassifiedPath`), so the `changes` job stopped the whole run.
2. Trailing blank lines at EOF in `qa/red-T13800.log` and `qa/green-T13800.log`: the `tooling` job's `git diff --check` fails.
3. Unsorted imports in a new backend test (`I001`, two findings): the `backend` job's ruff-growth gate fails before any test runs.
4. (Separate, real) a module-global leaking between test files; not a hygiene check, listed for completeness.

Each cost a ~9 minute CI round plus a host-side fix commit. Three are mechanical and belong in the worker's own pre-PUSHREADY step.

Independently, `dotask.sh land --after-test` printed for both groups:
`evidence: skipped (artifact 'r1' missing or escapes checkout: qa/red-AddFootageButton.creditRefresh.log)`.
`qa/proof.json` is tracked on master and accumulates every group's entries; entries whose artifacts were never committed (or were committed by a group whose logs are gitignored under `qa/`) make `scripts/dotask_evidence.py` bail on the FIRST missing artifact, so no group gets an evidence directory until the file is pruned.

## Solution

**Kickoff (scripts/dotask_cli.py template):** add an explicit "before PUSHREADY" step the worker runs and pastes the output of into `.dotask-status`:
- `git diff --check origin/master...HEAD` must be clean.
- `git diff --name-only origin/master...HEAD -- qa/` must contain only `QA_EVIDENCE` extensions (`.log .png .jpg .jpeg .webm .mp4 .txt .json`; import the tuple from `scripts/ci_policy.py` rather than duplicating it). A red-run isolation copy of a test lives outside the repo (e.g. `/tmp`) or is deleted before commit; `qa/proof.json` artifact paths point at the `src/` test.
- `python -m ruff check <changed backend files>` and the frontend lint skill on changed frontend files must pass (the ruff-growth gate compares merge-base vs head per file; new files start at 0 findings).
- `python scripts/ci_policy.py route --base origin/master --head HEAD` must not raise `UnclassifiedPath`.
Wrap these as `scripts/dotask_preland_check.sh <checkout>` so `dotask.sh land` (step 1) can run the same script host-side and refuse to record a tested HEAD while it fails; the worker and the host then agree on the bar.

**Evidence builder:** `scripts/dotask_evidence.py` should scope to the group's tasks (entries whose `criteria` carry the group's `T<id>:` prefixes) instead of validating every entry in the file; a missing artifact for ANOTHER group is a warning, not a bail. Then prune `qa/proof.json`: drop entries whose artifacts are absent from the repo at HEAD, recording the dropped criteria ids in the commit message, and add a `scripts/test_dotask_evidence.py` case for "unrelated entry with missing artifact does not block this group".

**Docs:** `.claude/skills/dotask/SKILL.md` and `.claude/skills/spawn-worker/SKILL.md` gain the pre-PUSHREADY step; `scripts/ci_policy.py`'s `KNOWN_STRAYS` list stays as the cleanup list and must NOT grow from this task.

## Context

### Relevant Files (REQUIRED)
- `scripts/dotask_cli.py` (kickoff template), `scripts/dotask.sh` (land step 1 calls the check), `scripts/dotask_preland_check.sh` (new), `scripts/dotask_evidence.py`, `scripts/test_dotask_evidence.py`, `scripts/test_dotask_cli.py`
- `qa/proof.json` (prune)
- `.claude/skills/dotask/SKILL.md`, `.claude/skills/spawn-worker/SKILL.md`
- Read-only: `scripts/ci_policy.py` (`QA_EVIDENCE`, `KNOWN_STRAYS`, `route`)

### Related Tasks
- T13790/T13800 (PR #659) and T13780 (PR #660): the incidents
- T6405 (layer-scoped Branch CI), T11210 (zero-callers grep lesson; same spirit: evidence must cover what CI does not run)

### Technical Notes
- Harness changes route to the `harness` CI job (`scripts/**`); `scripts/test_dotask_*.py` are listed in `SCRIPT_TESTS`, add any new test file there.
- Evidence for this task: a dry run of `dotask_preland_check.sh` against a checkout that reproduces each of the three misses (seed them in a temp branch) showing each one caught, plus the evidence builder producing a directory for a group while an unrelated entry's artifact is missing.

## Implementation

### Steps
1. [ ] `dotask_preland_check.sh` + unit test fixtures for the three misses
2. [ ] Kickoff template step + `dotask.sh land` step-1 refusal; `test_dotask_cli.py`
3. [ ] `dotask_evidence.py` group scoping + test; prune `qa/proof.json`
4. [ ] Skill docs; curated harness tests; review on the diff

## Acceptance Criteria

- [ ] A branch with a `qa/*.test.js` copy, an EOF blank line in a log, or a new `I001` finding fails `dotask_preland_check.sh` locally with the offending path named
- [ ] `dotask.sh land <slug>` refuses to record a tested HEAD while the check fails
- [ ] `land --after-test` produces an evidence directory for a group even when `qa/proof.json` holds another group's entry with a missing artifact
- [ ] `qa/proof.json` on master has no entries with missing artifacts; the pruned ids are in the commit message
