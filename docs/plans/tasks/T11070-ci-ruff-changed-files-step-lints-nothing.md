# T11070: CI "Ruff (changed files vs master)" step lints nothing

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-24
**Updated:** 2026-09-24

Found by the T8650 proof verifier on 2026-09-24. The user asked for it to be filed and done.

## Problem

In `.github/workflows/branch-ci.yml`, the backend job runs with
`defaults.run.working-directory: src/backend`. The step is:

```
git diff --diff-filter=ACMRT --name-only -z "$BASE_SHA...$HEAD_SHA" -- 'src/backend/**/*.py' |
  sed -z 's|^src/backend/||' | xargs -0 -r ruff check
```

Git resolves pathspecs relative to the current directory. From `src/backend`, the pattern
`src/backend/**/*.py` means `src/backend/src/backend/**/*.py`, which matches nothing. `xargs -r`
then skips ruff, and the step passes with no output on every branch.

Evidence: the T8650 round-1 commit had an F401 (an unused `timedelta` import) in a changed test
file. The step passed and printed nothing (run 36068775763 shows the command and no ruff output).

## Solution

1. Anchor the pathspec to the repo root, e.g. `':(top)src/backend/**/*.py'`. Keep the `sed` strip,
   because `--name-only` prints repo-root paths.
2. Turning the step on as written would fail any branch that touches a file already carrying
   part of the frozen backlog: `ruff check app` has 239 errors (T4790/T5020 baseline).
   So make it a per-file ratchet:
   - a changed file fails if it has MORE ruff errors at HEAD than at the merge-base;
   - a newly added file must have zero errors;
   - print ruff's findings for every changed file either way, so they are visible.
   The whole-app regression gate stays as it is.
3. Keep it greppable and simple: inline bash in the workflow, or a small script under `scripts/`
   next to the other CI helpers if the logic outgrows a step.

## Also fixed: the ESLint step had the same bug

The frontend job runs in `src/frontend`, and its "ESLint (changed files vs master)" step used the
same unanchored pathspec (`'src/frontend/**/*.js'`), so it has linted nothing either. The
frontend has 0 ESLint errors (351 warnings, and warnings do not fail the step), so anchoring the
pathspec with `:(top)` is enough; it needs no ratchet.

## Proof (2026-09-24)

`qa/t11070-harness.sh` and `qa/t11070-eslint-harness.sh` build scenario commits in a scratch
clone and run the old inline step (verbatim) and the new step:

| Scenario | Old step | New step |
|---|---|---|
| New ruff error in a changed file (`import os` in app/pricing.py) | exit 0, no output | exit 1, names F401 |
| Comment added to app/routers/detection.py (7 backlog findings, 0 new) | exit 0 | exit 0 (7 -> 7) |
| New file with a ruff error | exit 0 | exit 1 |
| New clean file | exit 0 | exit 0 |
| ESLint `no-undef` added to a changed file | exit 0, no output | exit 123 (xargs: eslint failed) |
| ESLint clean change | exit 0 | exit 0 |

## Acceptance Criteria

- [ ] On a branch that adds a new ruff error to a changed backend file, the step fails and names
      the error (red before the fix: the old step passes)
- [ ] On a branch that touches a file with pre-existing backlog errors but adds none, the step passes
- [ ] A new backend file with any ruff error fails the step
- [ ] The step prints ruff output for changed files (no more silent passes)
