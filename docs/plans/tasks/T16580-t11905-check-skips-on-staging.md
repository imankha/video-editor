# T16580: The Spotlight helper check skips itself on staging

**Status:** TODO
**Impact:** 3
**Complexity:** 1
**Created:** 2026-11-15
**Updated:** 2026-11-15

## Problem

After PR #773 merged, the /dotask staging check ran the browser check for T11905:C1 against staging and it
timed out. It looked like a bug. It is not: the check cannot work on a deployed site.

T11905:C1 (`src/frontend/e2e/checks/T11905.check.spec.js`) starts a separate Playwright run for each of
twelve Spotlight specs and fails unless every one of them opens a Spotlight draft. Several of those specs
only work on the dev stack. Run one by one against staging on 2026-11-15 (staging deploy 2ed5fb006):

- 4 passed (T10310 rail width, T11740 header overflow, T9270 CTA above the fold, T9550 Cover tab).
- 3 failed at sign-in: guide-no-overlap, T12730 and T4880 sign in with the dev fixture account
  imankh+devfixture@gmail.com, which does not exist on staging ("No user with email ... in staging Postgres").
- 2 skipped by design on a deployed target: bug38 glitch 3 and T10820 (dev-harness only).
- 1 failed on data: T9270 mobile drawer expects a portrait draft. The staging check account's draft is
  landscape, so the stage is 191 px tall, which is as tall as the screen width allows.
- 2 were not run because of a quoting problem in the ad-hoc runner, not in the specs.

So on staging this check can only fail or time out. It files a false bug every time a group that carries it
merges, and it hides real staging results behind a 20-minute wait.

## Solution

Make T11905:C1 skip itself, with a clear reason, when it runs against a deployed target (`E2E_BASE_URL` set),
the same way other dev-only checks do. On the dev stack (`scripts/dev-verify.sh`), nothing changes. The staging
check already records a check that skips itself on its target as `skipped`, never as a failure or a bug
(`run_browser_checks` in `scripts/dotask_cli.py`).

## Why

A staging check that always fails trains everyone to ignore staging failures, and that is the gate the owner
relies on after merge (owner decision 2026-11-09). T11905's own fix, finding Spotlight buttons by a fixed test id,
is already proven on the dev stack by this check and by T11905:C2.

## Acceptance Criteria

- [ ] C1: With `E2E_BASE_URL` set to staging, `npx playwright test e2e/checks/T11905.check.spec.js --grep 'T11905:C1'`
  reports the test skipped within a few seconds, with a reason naming the dev-only fixtures. It starts no child runs.
- [ ] C2: Without `E2E_BASE_URL` (the dev stack via `scripts/dev-verify.sh`), the T11905:C1 test is not skipped
  by this change: the skip condition depends only on `E2E_BASE_URL`.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/e2e/checks/T11905.check.spec.js`
- `src/frontend/e2e/checks/T16580.checks.json` (new)

### Related

- T11905 (the check), PR #773 (staging check that timed out), T15740 (earlier check that skipped itself on staging).
