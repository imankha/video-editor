# T16800: Staging check failed: T16730:C1 The steps above give the expected result.

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## Problem

Found by the staging check after PR #803 merged (group g-t16730-1, 788b8f73e). Impact and complexity are unscored defaults.

**Steps:** After PR #803 merged (788b8f73e), run `npx playwright test e2e/checks/T16730.check.spec.js --grep 'T16730:C1'` in src/frontend with E2E_BASE_URL=https://staging.reelballers.com E2E_API_BASE=https://api-staging.reelballers.com/api E2E_CHECK_EMAIL=e2e-gate@test.local.

**Expected:** The steps above give the expected result.

**Actual:** fail: TimeoutError: locator.waitFor: Timeout 480000ms exceeded.

### Where it stops (2026-11-17)

The check never reached the part T16730 fixed (the returning-parent card). It timed out at
`page.getByTestId('focus-publish-action-bar').waitFor({ timeout: 480000 })` in
`src/frontend/e2e/checks/T16730.check.spec.js`: after clicking Sharpen on staging, the ready panel did not appear
within 8 minutes. T16525:C2 failed on staging at the same place before. Find out first whether the staging sharpen
job finished (Modal run time, export row status for `e2e-gate@test.local`) and the panel failed to show, or the job
itself took longer than 8 minutes. If the first, that is a real bug in how Frame learns a sharpen finished; if the
second, the check's wait is wrong for staging, not the app.

### What happened (found 2026-11-17)

Neither case in the note above. A staging deploy restarted the server in the middle of the check:

- PR #803 merged at 13:54 UTC; its deploy finished at 13:59 and the staging check started.
- PR #802 merged at 14:02:33; its backend deploy ran 14:02:33 to 14:05:29.
- The check opened its draft (project 14, `last_opened_at` 14:03:50) and pressed Sharpen inside that window.
- No export job for that sharpen exists on staging: `/api/exports/active` and `/api/exports/unacknowledged`
  (which lists every finished or failed job of the last 24 hours) show only the 07:01 and 07:08 jobs. The
  sharpen was lost with the old server, so the check waited 8 minutes for a panel that could never come.

It happened again while this was being investigated: a run started at 16:23 overlapped the 16:24 to 16:27
backend deploy, and that sharpen also left no job. Runs on a quiet staging passed: the sharpen finished in
107 and 121 seconds with the ready panel shown, and `T16730.check.spec.js --grep 'T16730:C1'` passed in
2.3 minutes (16:37 UTC).

### What we did

- The staging check no longer files a failure that overlapped a deploy. `staging_check` in
  `scripts/dotask_cli.py` asks GitHub which deploy runs were still running once the check started
  (`staging_redeploy_since`); when one was, it waits for that deploy and re-runs only the failed criteria.
  It files a bug only if a criterion fails again. The status line says `re-ran <ids> after a deploy during the check`.
- The product gap this exposed (a sharpen lost to a server restart leaves Frame waiting with no message,
  because a 404 from `GET /api/exports/{id}` keeps the poll going) is filed as T16830.

- The criterion's check is a browser check, `src/frontend/e2e/checks/T16800.check.spec.js`, that runs the
  T16730:C1 steps (shared with T16730's check in `src/frontend/e2e/helpers/returnAfterSharpen.js`). On
  2026-11-17 the staging test account's last two unsharpened drafts sat on a game stuck uploading, where Frame
  shows no Sharpen button; the shared steps now pick a draft on a ready game, or make another highlight from a
  play on one. It passed on staging at 17:12 UTC (2.9 minutes) and on the dev stack.

## Acceptance Criteria

- [ ] The steps above give the expected result.

## Context

### Relevant Files (REQUIRED)

- `scripts/dotask_cli.py` (`staging_check`, `staging_redeploy_since`, `wait_for_staging_deploy`)
- `scripts/test_dotask_cli.py` (`StagingCheckTest`)
- `src/frontend/e2e/checks/T16730.check.spec.js` (the check that failed)
