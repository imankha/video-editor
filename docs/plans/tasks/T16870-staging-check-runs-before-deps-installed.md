# T16870: The staging check runs before the container has its packages, and files false bugs

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

**Today.** After a group's PR merges, `staging-check` (`scripts/dotask_cli.py`, `def staging_check`) restarts the
group's container if it was stopped and runs the browser checks there against staging. Restarting runs
`task.sh up`, which starts installing the frontend packages in the background ("installing frontend deps
(one-time, ~1-2 min; runs in background)").

**The problem.** On 2026-11-17 the re-run of PR #805's staging check started Playwright before that install
finished. Playwright crashed on a missing module (`internal/modules/esm/resolve`), and the check filed two bug
tasks for checks that never ran (both deleted by hand), with "no Playwright report (exit 1)" as the failure.
An earlier attempt failed the other way: `docker exec` on a container that was still stopping.

**What we will do.** Before running checks, wait until the container is running and its frontend packages are
installed (for example `@playwright/test` present and no install still running), with a time cap. If the cap
passes, stop with `STAGING_CHECK_BLOCKED` and keep the container, as a failed deploy does. Never file a bug when
Playwright produced no report: that is the harness failing, not the app.

**How we will know it worked.** A staging check run on a freshly restarted container runs its checks; a run whose
Playwright crashes before any test reports BLOCKED and files nothing.

## Acceptance Criteria

- [ ] C1: `staging_check` waits for the container's frontend packages before running checks (test with a fake
  container that reports the install still running, then done).
- [ ] C2: A Playwright run that produced no report gives `STAGING_CHECK_BLOCKED` and files no bug task (test in
  `scripts/test_dotask_cli.py`).

## Context

### Relevant Files (REQUIRED)

- `scripts/dotask_cli.py`
- `scripts/test_dotask_cli.py`
