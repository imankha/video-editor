# T16860: The verify budget is spent starting the stack, so criteria go unchecked

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

**Today.** After a /dotask group's tasks are built, `autoland` checks each acceptance criterion within a budget of
3 minutes per criterion (`DOTASK_VERIFY_BUDGET_MIN`). The clock starts before the group's app stack is brought up
and warmed (`bring_up_stack` + `warm_stack` in `scripts/dotask_cli.py`, verify loop around line 2040), and on
2026-11-17 the warm-up alone took 223 to 229 seconds.

**The problem.** A one-criterion group has 3 minutes in total, and a two-task group 6 to 12, so most of the budget
goes to the stack start. On 2026-11-17 five groups (g-t16740-2, g-t16750-2, g-t16800-1, g-t16830-1, and earlier
g-t16525-1) reached READY_TO_TEST with every criterion "not verified". Each one was re-run by hand with
`DOTASK_VERIFY_BUDGET_MIN=45`, where every criterion was then checked in a few minutes, and two of those re-runs
found real failures the first pass had skipped.

**What we will do.** Start the budget clock after the stack is up and warm, so the budget pays only for running
and reviewing checks. Keep a separate cap on the stack start (it already has one: 300 s in `task.sh`).

**How we will know it worked.** A one-criterion group whose stack takes 4 minutes to warm still runs and reviews
its check within the default budget.

## Acceptance Criteria

- [ ] C1: In the verify loop, time spent in `bring_up_stack` and `warm_stack` is not counted toward
  `verify_spent_s`; a test in `scripts/test_dotask_cli.py` with a slow fake stack start shows the checks still run.
- [ ] C2: A stack that fails to start or warm still stops the loop as today (`VERIFY_BLOCKED`), not as a pass.

## Context

### Relevant Files (REQUIRED)

- `scripts/dotask_cli.py`
- `scripts/test_dotask_cli.py`
