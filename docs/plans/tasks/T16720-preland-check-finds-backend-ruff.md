# T16720: The pre-land check says ruff is missing when the backend has it

**Status:** STAGING
**Impact:** 5
**Complexity:** 1
**Created:** 2026-11-17
**Updated:** 2026-11-17

## Problem

On 2026-11-17 the T16525 group (g-t16525-1) stopped twice with "pre-land check failed", although nothing in its
branch was wrong. The pre-land check (`scripts/dotask_preland_check.sh`) runs on the host and looks for ruff only
as `python3 -m ruff`. The Claude Code terminal that launched the loop had VS Code's virtualenv for an unrelated
folder (`gemini_analysis_test/.venv`) active, so `python3` had no ruff and the check failed with "ruff is not
installed". Ruff was installed all along, in `src/backend/.venv`, which is where the lint hook
(`.claude/hooks/lint-changed.cjs`) finds it.

Each false failure cost a fix-round dispatch. One fix worker then committed a change to the check onto the T16525
feature branch. That was the wrong place for it, and it could not help, because the host runs master's copy of the
script. The change was taken off that branch and kept on the branch `backup/T16525-preland-ruff-fix` (pushed to origin)
(commit `e65667b2f`, in `C:\work\tasks\g-t16525-1`).

## Solution

Let the pre-land check use ruff from `src/backend/.venv` (`Scripts/ruff.exe` on Windows, `bin/ruff` elsewhere) or
from PATH when `python3 -m ruff` is missing. Fail only when none of them exist. The backup commit already does this (`git fetch origin backup/T16525-preland-ruff-fix`)
and adds a test to `scripts/test_dotask_cli.py`: cherry-pick it onto a branch from master, then review it.

## Acceptance Criteria

- [ ] C1: With `python3` lacking ruff but `src/backend/.venv` having it, `bash scripts/dotask_preland_check.sh` on
  a checkout that changes a backend file runs ruff and passes (test in `scripts/test_dotask_cli.py`).
- [ ] C2: With no ruff anywhere, the check still fails and names the files that need linting.

## Context

### Relevant Files (REQUIRED)

- `scripts/dotask_preland_check.sh`
- `scripts/test_dotask_cli.py`
