# T8620: Append-only payments ledger + Stripe backfill

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-03
**Updated:** 2026-09-03

Epic 1/6. See [EPIC.md](EPIC.md) for the incident, the research, and the locked design
decisions. This task creates the record everything else in the epic reads or preserves.

## Problem

We have no local financial record of an individual payment.

- `user_segments.total_spent_cents` is a single mutable counter per user, with no
  history, no payment ids, and no audit trail. It is incremented at fulfillment
  ([analytics.py:986](../../../../src/backend/app/analytics.py#L986)), decremented on
  refund ([analytics.py:999](../../../../src/backend/app/analytics.py#L999)), and
  overwritten by the reconciliation heal
  ([analytics.py:1037](../../../../src/backend/app/analytics.py#L1037)).
- `credit_transactions` does carry the PaymentIntent id in `reference_id`, but it is an
  ENTITLEMENT ledger (how many credits the user may spend), not a revenue ledger, and it
  is deliberately purged when an account is deleted
  ([auth.py:116](../../../../src/backend/app/routers/auth.py#L116)) so a re-register
  starts at a true zero. That purge is correct for credits and fatal for money.

Consequence, proven on prod: a deleted payer erases $3.99 of real revenue from our books
while Stripe keeps the charge forever.

Second, independent defect in the same write path: `increment_total_spent` is a bare
`UPDATE` with no rowcount check. A payer with no `user_segments` row records nothing and
still logs "Incremented". Such users exist (see the LEFT JOIN note at
[admin.py:232](../../../../src/backend/app/routers/admin.py#L232): segment rows are
created only in the OAuth/OTP signup flows).

## Solution

A new append-only `payments` table in Postgres, written in the same `applied` branch that
already gates revenue analytics, plus a one-time backfill from Stripe so history is
complete from go-live.

### Schema (track `postgres`, next free version after v026)

```sql
CREATE TABLE IF NOT EXISTS payments (
    id                BIGSERIAL PRIMARY KEY,
    user_id           TEXT        NOT NULL,   -- opaque UUID, NEVER an email or name
    kind              TEXT        NOT NULL,   -- 'purchase' | 'refund' | 'dispute_lost' | 'dispute_won'
    amount_cents      INTEGER     NOT NULL,   -- signed: purchase > 0, refund/dispute_lost < 0
    currency          TEXT        NOT NULL DEFAULT 'usd',
    stripe_object_id  TEXT        NOT NULL,   -- pi_... for a purchase, re_.../dp_... for an adjustment
    stripe_charge_id  TEXT,
    pack              TEXT,                   -- 'starter' | 'popular' | 'best_value' | NULL
    credits           INTEGER,                -- credits sold, for the purchase row
    occurred_at       TIMESTAMPTZ NOT NULL,   -- Stripe's timestamp, not ours
    recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    source            TEXT        NOT NULL,   -- 'confirm_intent' | 'webhook' | 'backfill'
    account_deleted_at TIMESTAMPTZ            -- stamped by T8630, never used to filter revenue
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_object_kind
    ON payments(stripe_object_id, kind);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, occurred_at DESC);
```

Rules that make this a ledger and not another cache:

- **Append-only.** No code path may `UPDATE` `amount_cents` or `DELETE` a row. A
  correction is a new row. The single permitted in-place write is T8630's
  `account_deleted_at` stamp, which is metadata about the account, not about the money.
- **Idempotent by construction.** The unique index on `(stripe_object_id, kind)` is what
  makes a webhook redelivery a no-op instead of double revenue. Insert with
  `ON CONFLICT DO NOTHING` and treat "0 rows inserted" as success, not as an error. This
  is also the durable refund idempotency the `charge.refunded` branch was documented as
  lacking ([payments.py:425](../../../../src/backend/app/routers/payments.py#L425)).
- **Pseudonymous.** `user_id` only. No email, no name, no card data, nothing that makes
  the row personal data. This is what allows it to survive an erasure request (see
  EPIC.md research).
- **Signed amounts, never a running total.** Net revenue for a user is
  `SUM(amount_cents)`, which is derivable at any time and cannot silently drift.

Update `_SCHEMA_DDL` in [pg.py](../../../../src/backend/app/services/pg.py) as well as
writing the migration, so fresh deployments get the table (CLAUDE.md migration rule).

### Write path

Insert a `purchase` row alongside every place that currently calls
`increment_total_spent` inside an `if result["applied"]` branch:

- [payments.py:284](../../../../src/backend/app/routers/payments.py#L284) confirm-intent
- [payments.py:352](../../../../src/backend/app/routers/payments.py#L352) webhook, checkout.session.completed
- [payments.py:388](../../../../src/backend/app/routers/payments.py#L388) webhook, payment_intent.succeeded
- [payments.py:553](../../../../src/backend/app/routers/payments.py#L553) verify_session

Insert a `refund` row (negative) in the `charge.refunded` branch
([payments.py:431](../../../../src/backend/app/routers/payments.py#L431)) next to the
existing `decrement_total_spent`.

Amount source: use the amount Stripe actually captured, not `CREDIT_PACKS[pack]
["price_cents"]`. The pack constant is a repricing-sensitive local table (T4940 changed
it once already) and the ledger must record what was charged. Read
`amount_received`/`amount_captured` from the intent or charge; keep the pack key as
metadata only.

Keep `increment_total_spent` and `decrement_total_spent` calls exactly where they are.
The cache stays for now; T8650 decides what reads it.

### Fix the silent no-op in the same pass

`increment_total_spent` becomes an upsert against `user_segments` (or, at minimum, checks
`cur.rowcount` and logs a CRITICAL when it matched no row). A payment that cannot find
its segment row must be loud, never a success log. Same treatment for
`decrement_total_spent`'s existing early return, which already warns; keep that.

### Backfill

One-time, idempotent, safe to re-run: fetch live PaymentIntents with the existing
`fetch_stripe_intents` ([revenue_reconciliation.py:187](../../../../src/backend/app/services/revenue_reconciliation.py#L187))
and insert a `purchase` row per succeeded intent, plus `refund`/`dispute_lost` rows from
the expanded charge. The unique index makes re-runs harmless.

**The 2026-08-24 orphan is in scope and is the point:** `pi_3U7p5aIxob3dHqK01QfOa5qu`,
user_id `fb40690a-edcf-4504-a51f-f9df6f84ac4f`, $3.99. It backfills into a row whose
`user_id` matches no `users` row. That is not an error to handle, it is the tombstone
working as designed.

Deliver the backfill as a standalone script under `scripts/` (dry-run by default, printing
the rows it would write) rather than as a migration `up()`. It needs live Stripe
credentials, which a migration running at a per-user DB seam does not have, and the
postgres track runs on an admin trigger anyway.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/postgres/v0NN_payments_ledger.py` - new
- `src/backend/app/services/pg.py` - `_SCHEMA_DDL`
- `src/backend/app/services/payments_ledger.py` - new, the insert helpers
- `src/backend/app/routers/payments.py` - 284, 352, 388, 431, 553
- `src/backend/app/analytics.py` - 986 (upsert fix), 999
- `scripts/backfill_payments_ledger.py` - new
- `src/backend/tests/` - ledger idempotency + write-path tests

### Related Tasks
- Blocks T8630 (deletion must preserve THIS table), T8640, T8650, T8670
- Check unmerged sibling branches for a colliding postgres migration number before
  claiming one (see the migration-version-collision landmine)

### Technical Notes
- Postgres track means: no JIT seam, applied by `POST /api/admin/migrate-postgres` after
  deploy. Prod is currently at v25 and still owes v026 (see EPIC.md operational note), so
  the operator step covers both.
- Do not add a `payments` write to the credit-grant service. Credits and money are
  separate ledgers on purpose; coupling them is what made deletion destroy revenue.

## Implementation

### Steps
1. [ ] Design gate: confirm the schema and the "corrections are new rows" rule
2. [ ] Migration + `_SCHEMA_DDL`
3. [ ] `payments_ledger.py` insert helpers with `ON CONFLICT DO NOTHING`
4. [ ] Wire the 4 purchase sites + the refund site
5. [ ] Upsert/rowcount fix in `increment_total_spent`
6. [ ] Backfill script, dry-run first
7. [ ] Tests, then run the backfill against staging before prod

## Acceptance Criteria

- [ ] A live purchase writes exactly one `payments` row; a webhook redelivery of the same
      event writes none and does not error
- [ ] A refund writes a second, negative row; a redelivered refund writes none (the
      documented idempotency gap is closed)
- [ ] `SUM(amount_cents)` per user equals the Stripe net the reconciler computes, for
      every user with live history
- [ ] The backfill is re-runnable with no duplicate rows, and after it runs on prod the
      2026-08-24 orphan has a `payments` row
- [ ] `increment_total_spent` against a missing `user_segments` row logs CRITICAL instead
      of a success line
- [ ] No code path updates or deletes a ledger row (grep-verified in review)
