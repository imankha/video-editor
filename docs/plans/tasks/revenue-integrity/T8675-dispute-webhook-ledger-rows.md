# T8675: Dispute webhook writes ledger rows

**Status:** STAGING (merged 2026-09-25, PR #512, a5ea6fbb; proof VERIFIED at ecf340ca, Branch CI green. Operator: subscribe live webhook to charge.dispute.closed, charge.refund.updated, refund.updated)
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

## Also in scope: refunds that settle later (added 2026-09-24, T8620 proof verification)

T8620 records only `succeeded` refunds when `charge.refunded` fires. A refund that is still
`pending` at that moment is skipped, and no handler reacts when it later settles, so it reaches
the ledger only on another refund event for the same charge or a backfill re-run. Card refunds
normally succeed immediately, so the exposure is small. Handle `charge.refund.updated` (or
`refund.updated`) through the same idempotent `record_refund` path.

## Operator note (webhook subscriptions)

The live-mode webhook endpoint in the Stripe dashboard must subscribe to the events this task
handles, alongside the existing `charge.refunded` subscription from T8620 (webhook events are
per-endpoint and per-mode, so a code branch does nothing until its event is subscribed):

- `charge.dispute.closed` (chosen over `charge.dispute.funds_withdrawn`/`funds_reinstated`: only
  `closed` is terminal, so a single append-only `dispute_lost` row on `status == "lost"` needs no
  later reversal; funds_withdrawn fires at dispute creation and can still be reinstated on a win).
- `charge.refund.updated` (sent for a refund status transition on most/legacy API versions) AND
  `refund.updated` (the newer top-level equivalent). We pin no Stripe API version, so subscribe to
  both; the shared `(re_..., refund)` idempotency key makes handling both a safe no-op if both fire.

## Acceptance Criteria

- [ ] A lost dispute writes exactly one negative `dispute_lost` row; a redelivery writes none
- [ ] A won dispute writes no row
- [ ] A refund that settles after `charge.refunded` fired writes its row exactly once
- [ ] The per-user `SUM(amount_cents)` matches the Stripe net the reconciler computes after a lost dispute
