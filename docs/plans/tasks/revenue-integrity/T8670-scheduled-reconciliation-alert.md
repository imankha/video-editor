# T8670: Scheduled reconciliation with a drift alert

**Status:** TODO
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

- [ ] A scheduled pass runs without a human, at a documented interval, once per deploy and
      not once per machine
- [ ] It alerts only on `unknown` drift and pending disputes, and is silent when every row
      is explained
- [ ] It reuses the existing classifier with no duplicated logic
- [ ] A synthetic unexplained drift produces the alert in a test
- [ ] Running it changes no data (read-only pass; healing stays an explicit admin gesture)
