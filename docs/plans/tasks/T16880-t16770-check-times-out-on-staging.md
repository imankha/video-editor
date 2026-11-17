# T16880: The T16770 check times out on staging

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

**Today.** T16770 (a second play saved right after the first when the parent seeks during the first play's save)
merged in PR #805 with a browser check, `src/frontend/e2e/checks/T16770.check.spec.js` (criterion T16770:C2), that
passed on the dev stack.

**The problem.** On staging the check timed out twice on 2026-11-17 (16:28 UTC, and again at about 18:30 UTC with no
deploy running). A timeout is not filed as a bug, so nothing tracked it. The same day, T16810 found that the staging
check account (`e2e-gate@test.local`) has only one ready game ("game-desktop", game 3); game 2 is stuck at
`storage_status=uploading`, and a check that picks it waits forever. The T16770 check may pick a game that way, or
may rely on the account's first play (the "Keep marking plays" prompt shows only on an account's first play, which
`e2e-gate` used up long ago).

**What we will do.** Run the check against staging, find where it waits, and make it set up its own state the way
a parent does on any account (pick only a game whose status is ready; reach the prompt in a way that works on an
account that already has plays, or say plainly in the check why it cannot and mark the criterion `human`). If the
app itself is wrong on staging, fix the app instead.

**How we will know it worked.** `T16770:C2` passes against staging with the staging check's settings.

## Acceptance Criteria

- [ ] C1: `npx playwright test e2e/checks/T16770.check.spec.js --grep 'T16770:C2'` with `E2E_BASE_URL=https://staging.reelballers.com`,
  `E2E_API_BASE=https://api-staging.reelballers.com/api`, `E2E_CHECK_EMAIL=e2e-gate@test.local` passes, and still
  fails on the code before PR #805 (or the task records why the criterion is `human`).

## Context

See the `## T16810` notes on how to run a check against staging from a container, and
`src/frontend/e2e/helpers/sharpenWhilePreviewing.js` for making a fresh draft from the one ready game.

### Relevant Files (REQUIRED)

- `src/frontend/e2e/checks/T16770.check.spec.js`
- `src/frontend/e2e/checks/T16770.checks.json`
