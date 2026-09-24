# T8675: Dispute webhook writes ledger rows

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-24
**Updated:** 2026-09-24

Epic follow-up. See [EPIC.md](EPIC.md). Split out of T8620 at its design gate (user ruling
2026-09-24, decision 1): T8620 writes no live dispute rows, and the backfill writes
`dispute_lost` only for disputes that were already lost.

## Problem

No Stripe dispute webhook exists. A dispute that is lost after T8620 ships leaves the
`payments` ledger reporting more revenue than Stripe by the disputed amount until someone
re-runs the backfill. The reconciler computes that gap, so the drift is visible, but it is
never closed automatically.

## Solution

Handle `charge.dispute.closed` (and decide whether `charge.dispute.funds_withdrawn` /
`funds_reinstated` are the better money-moving events) in `routers/payments.py`. When the
dispute is lost, write a negative `dispute_lost` row via `payments_ledger.record_dispute_lost`,
keyed on the `dp_...` id. Use T8620's contract: record on every observation, idempotent through
the unique key, and move the `total_spent` cache only when a new row is inserted. A won
dispute writes no row, because no money moved.

No automated refund or account behaviour (EPIC decision 6).

## Context

### Relevant Files
- `src/backend/app/routers/payments.py` - new webhook branch
- `src/backend/app/services/payments_ledger.py` - `record_dispute_lost` (exists after T8620)
- Stripe dashboard: the webhook endpoint must subscribe to the chosen dispute event(s). This is
  an operator step.

### Related Tasks
- Depends on: T8620
- Interacts with: T8640 (reconciliation causes), T8670 (scheduled drift alert)

## Acceptance Criteria

- [ ] A lost dispute writes exactly one negative `dispute_lost` row; a redelivery writes none
- [ ] A won dispute writes no row
- [ ] The per-user `SUM(amount_cents)` matches the Stripe net the reconciler computes after a lost dispute
