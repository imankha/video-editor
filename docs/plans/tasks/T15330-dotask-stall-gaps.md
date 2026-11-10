# T15330: dotask stall fixes

## In plain words

Seven ways the automated task runner stopped and needed a person last week, each with a tooling fix. On staging.


**Status:** STAGING
**Impact:** 7
**Complexity:** 3
**Tier:** M (tooling only: scripts/dotask_cli.py, scripts/task.sh, their tests, the dotask skill)
**Created:** 2026-11-08
**Updated:** 2026-11-08

## Ruling

Owner approved 2026-11-08 ("yes please") the seven fixes proposed after the spend-readiness run, on
the condition from the memory rule that `task.sh` is never edited under a live run. Live loops run
`scripts/task.sh` from the main checkout, so this was built in a separate clone, and the merge must not
be pulled into the main checkout while any group is running.

## Problem

The spend-readiness run (groups g-t15230-1, g-t15200-1, g-t14940-1, g-t14930-3, g-t15280-3,
2026-11-07/08) stopped or needed a person seven ways that the tooling could have handled:

1. `AUTH_DEAD` on one failed `claude auth status`; every one cleared on a plain resume.
2. Red Branch CI after a clean verdict (PRs #720, #722, #723) was reported and left for a person.
3. A fix worker that disputed a finding (a flake) could only `BLOCKED`, which stopped the loop.
4. A criterion (T14960:C4) needed a task running in another group; nothing warned at `start`.
5. An auto-filed bug (T15300) stayed uncommitted: its id was taken again by hand and the file was
   swept into an unrelated plan commit.
6. `npm install` churn of `package-lock.json` and landing build logs under `qa/` read as "verifier
   changed the tree".
7. A relaunch while the first `resume` still ran gave two drivers on one checkout.

## Solution

1. `task.sh drive` retries the auth check up to 3 times, 20 s apart, re-seeding credentials each time.
2. `land(fix_on_red=True)` returns `CI_RED`; autoland turns the failed jobs and log tail into a `group`
   bug, runs a fix round, re-checks and pushes again (counts against `MAX_FIX_ROUNDS`).
3. Fix workers end on `DISPUTED <label> <finding>: <evidence>`; the next verifier re-examines with that
   evidence; a finding it still upholds stops with `VERIFY_NEEDS_USER` naming both sides.
4. `start` warns about criteria naming a task outside the group that is not STAGING/DONE.
5. `file_unrelated_bug` commits the task file and PLAN row alone to master in the main checkout (not
   pushed), skips ids PLAN.md already uses, and leaves a PLAN.md holding someone's edit uncommitted.
6. The verifier tree check puts back `package-lock.json` and `qa/` changes and ignores them.
7. `resume`/`autoland` hold `.dotask-run.lock` (pid); a live holder refuses a second driver, a dead one
   is taken over.

## Context

### Relevant Files (REQUIRED)
- `scripts/dotask_cli.py`
- `scripts/task.sh`
- `scripts/test_dotask_cli.py`
- `scripts/test_task_run.sh`
- `.claude/skills/dotask/SKILL.md`

## Acceptance Criteria

- [ ] One transient auth failure does not write AUTH_DEAD; three do (test_task_run.sh).
- [ ] Red CI after VERIFY_PASS runs a fix round and lands on the re-check; a hand `land --after-test` still reports red CI and returns 0.
- [ ] A disputed finding reaches the next verifier with the fixer's evidence; one the verifier upholds stops with VERIFY_NEEDS_USER.
- [ ] `start` warns about a criterion naming an unlanded task outside the group.
- [ ] A filed bug is committed alone and skips ids PLAN.md uses; a dirty PLAN.md is not committed.
- [ ] Lockfile and qa/ churn do not block a verdict; a real edit still does.
- [ ] A second driver is refused while the first lives; a stale lock is taken over and released.
