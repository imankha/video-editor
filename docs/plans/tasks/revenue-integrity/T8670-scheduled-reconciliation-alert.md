# T8670: Scheduled reconciliation with a drift alert

**Status:** STAGING (merged 2026-09-26, PR #514, 996302e8; proof VERIFIED at 10bd7fe5 across 3 fix rounds -- real mid-pass connection kills proved the marker survives -- Branch CI green)
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03

Epic 6/6. See [EPIC.md](EPIC.md). Depends on T8640 (so the check does not alert on rows it
cannot explain).

## Problem

Reconciliation is on-demand only: `GET /api/admin/revenue-reconciliation`
([admin.py:745](../../../../src/backend/app/routers/admin.py#L745)) runs when a human opens
the panel and clicks. The 2026-08-24 drift sat undetected until 2026-09-03, and only
because the owner happened to look and happened to ask about a number that looked wrong.

Standard practice is the opposite: the processor is the source of truth, the local ledger
is reconciled against it on a schedule, and unexplained drift raises an alert rather than
waiting to be noticed (EPIC.md research).

## Solution

A scheduled reconciliation pass that runs the SAME pure classifier the panel uses, and
alerts only on drift it cannot explain.

- **Reuse, do not rebuild.** `_compute_reconciliation`
  ([admin.py:715](../../../../src/backend/app/routers/admin.py#L715)) already returns rows
  plus the Stripe aggregate, and the classifier is pure. The scheduled job is a thin
  caller. Extract the shared piece into a service if the router import is awkward, but do
  not write a second classifier (the project rule: extend, do not build a parallel
  system).
- **Alert only on `unknown`.** After T8640, `aligned`, `test_mode_era`, `refund`,
  `dispute` and `account_deleted` are all explained states. `unknown` is the one that
  means "money moved and we cannot say why", which is precisely the alert condition. A
  pending dispute (`has_pending_dispute`) is worth surfacing too, since it is a deadline,
  not just a discrepancy.
- **Where it runs.** Reuse the existing background scheduler rather than adding
  infrastructure (see `sweep_scheduler` and the background loops already described in
  CLAUDE.md's migration section). Weekly is enough for the current volume; make the
  interval a constant, not a magic number. It must be a single-machine job: a Fly app with
  multiple machines must not run it once per machine and alert N times.
- **How it alerts.** Simplest sufficient channel first: a CRITICAL log line with the
  drifted user ids and amounts, which is greppable and costs nothing. An email to the
  admin address via the existing Resend service is the natural upgrade, and per the
  project's fire-and-forget deferral, an email send from a background loop needs the same
  care as any other background send. Do not add a new alerting dependency.
- **Cost.** One `PaymentIntent.list` pagination per run, tiny at current volume. Do not
  run it per-request or on any user-facing path.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` - 715 (`_compute_reconciliation`), 745
- `src/backend/app/services/revenue_reconciliation.py` - the pure classifier
- The existing background scheduler module (sweep scheduler)
- `src/backend/app/services/email.py` - only if the email channel is included

### Related Tasks
- Depends on T8640, otherwise a deleted payer alerts forever as `unknown`
- **Overlaps [T1702](../analytics/T1702-monetization-intelligence.md)** (Monetization +
  Intelligence: Stripe revenue tracking, nightly analytics engine, hourly/weekly alerts).
  This task is the narrow drift-alert slice. If T1702 is picked up first, fold this into
  it rather than shipping two schedulers; if this lands first, T1702 must reuse the job it
  creates.

## Acceptance Criteria

- [x] A scheduled pass runs without a human, at a documented interval, once per deploy and
      not once per machine
- [x] It alerts only on `unknown` drift and pending disputes, and is silent when every row
      is explained
- [x] It reuses the existing classifier with no duplicated logic
- [x] A synthetic unexplained drift produces the alert in a test
- [x] Running it changes no data (read-only pass; healing stays an explicit admin gesture)

## Implementation (2026-09-26)

`services/reconciliation_alert.py`  -  a thin background caller around the panel's
`_compute_reconciliation`. Weekly loop (`WEEKLY_INTERVAL_SECONDS`) wired into `main.py`
lifespan (`start_reconciliation_alert_loop`/`stop_reconciliation_alert_loop`), mirroring
`sweep_scheduler`/`cleanup`. Single-machine coordination via a Postgres session-level
advisory lock `pg_try_advisory_lock(RECONCILIATION_ALERT_LOCK_ID=8670)` held for the whole
pass and released explicitly with `pg_advisory_unlock` in a `finally` (pooled connections
never disconnect, so auto-release is not relied on). Alerts (CRITICAL log always + admin
email additionally) only on `unknown` rows and pending disputes; silent otherwise;
read-only. Tests: `tests/test_t8670_reconciliation_alert.py`. Knowledge doc updated:
`.claude/knowledge/backend-services.md` (reconciliation section).

### Round 2 (2026-09-26): at-most-once-per-interval, not once-per-machine

The advisory lock alone only excludes passes that overlap IN TIME. Two Fly machines (or one
restarted machine) each start their own startup-delay-then-weekly timer, so two
non-overlapping passes each acquire the lock in turn and each alert. Fix: a PERSISTED
single-row marker `reconciliation_alert_runs (id=1, last_run_at)` (postgres v034, mirrored in
`_SCHEMA_DDL`). Inside the same lock-held section the pass reads `last_run_at`; younger than
one interval → `skipped_recent` (no compute/alert/write beyond the lock); else it runs and
upserts `last_run_at=now()` before releasing the lock. The cleanup tail (`_finish_pass`:
upsert marker FIRST, then unlock) is best-effort and never propagates: `get_pg` RE-RAISES a
dead-connection error on its exit-commit, so a post-alert connection death no longer bubbles
out to make the outer loop retry-and-re-send. Because the marker is stamped before the
unlock, a death on the unlock step still leaves it persisted, so the retry skips. The pass
also runs ~60s after every boot/deploy (`STARTUP_DELAY_SECONDS`), not on a fixed wall clock.

### Round 3 (2026-09-26): fresh-connection marker write closes the mid-pass death gap

Round 2 wrote the marker through the lock connection's OWN cursor. If that connection died at
any point mid-pass (not just on the final unlock statement) the marker upsert never ran, the
alert had already gone out, and the next pass re-sent it. Round 2's test only faked the final
unlock statement raising on an otherwise-live connection, so it never exercised this path. Fix:
`_finish_pass` now upserts `last_run_at` on a FRESH, SEPARATE `get_pg()` connection (not the
lock connection) BEFORE releasing the lock, so a lock-connection death at ANY point up to and
including the unlock still leaves the marker persisted. New test
`TestFreshConnectionMarkerSurvivesLockConnDeath` kills the REAL lock backend mid-pass (via
`pg_terminate_backend` AND `idle_in_transaction_session_timeout`) after the alert is sent and
asserts the immediately-following pass returns `skipped_recent` with zero emails. The only
residual double-alert path is the fresh marker connection ITSELF failing (a rare loud duplicate,
never a silent stall). Separately, the loop now sleeps only the time REMAINING until due on a
`skipped_recent` boot (`next_run_in_seconds`, floored at `MIN_RESLEEP_SECONDS`) instead of a
fresh full interval, removing the up-to-~2x spacing slop.

**This is the LAST task in the Revenue Record Integrity epic  -  see EPIC.md. The epic is
NOT marked COMPLETE: DONE is the user's gesture, and one completion criterion (0 unexplained
drift on a real prod reconciliation run) awaits prod migrate-postgres + backfill.**
