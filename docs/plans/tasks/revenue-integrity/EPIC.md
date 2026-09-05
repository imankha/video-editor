# Revenue Record Integrity

**Status:** TODO (sequenced AFTER the Tutorial Redesign group, user order 2026-09-03)
**Started:** (not started)
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-03

## Goal

Make our own books able to answer "how much money have we taken, and for what" without
asking Stripe, and keep that answer true after an account is deleted. Today the only
local record of revenue is a mutable per-user counter that is destroyed with the user
row, so a deleted payer silently removes money from our reporting while Stripe keeps it
forever.

Completion means: every live Stripe payment has a matching local, append-only record;
deleting an account never removes that record; the reconciliation panel can explain and
close every drift it reports; and admin revenue totals no longer depend on a per-user
cache that deletion can zero out.

## The incident that opened this (2026-09-03)

The admin Revenue Reconciliation panel showed 1 of 4 users drifted: local $0.00 vs Stripe
net $3.99, cause "Unknown", 1 PaymentIntent, user id `fb40690a-edcf-4504-a51f-f9df6f84ac4f`
rendered as a raw id because no email resolved.

Verified against prod Postgres and live Stripe (read-only):

| Fact | Evidence |
|------|----------|
| The payment is real and unrefunded | `pi_3U7p5aIxob3dHqK01QfOa5qu`, $3.99 starter pack (80 credits), succeeded 2026-08-24 04:02:26 UTC, Visa 7576, billing ZIP 97223, `refunded: false`, `disputed: false`, customer `cus_V85FUHqFrK4TYR` with `metadata.user_id = fb40690a...` |
| Fulfillment worked at the time | `daily_counters` for 2026-08-24 has `credit_purchases: 1`. That counter is written in the same `applied` branch as `increment_total_spent`, so the local value really was 399 on that day |
| The account is gone | No row in `users`, `user_segments`, `credits`, `credit_transactions`, `user_actions`, `sessions`, `game_storage_refs`. A scan of all 86 text/uuid/json columns across all 24 prod tables found only 2 survivors: `user_usage_daily` (2026-08-24, 622 seconds) and `impersonation_audit` (4 rows, admin impersonated 05:00 to 05:05 UTC on 2026-08-24) |
| Storage is gone | `production/users/fb40690a-.../` in R2 lists 0 objects |
| Nothing else drifts | Local $20.97 (1299 + 399 + 399) plus this orphaned 399 equals Stripe's $24.96 exactly |

**Who it was: bigajosue@gmail.com.** Not recoverable from any database (Postgres and R2
were both purged), but recoverable from our own task docs, where this exact user id is
documented as the headline casualty of the 2026-08 upload outage:
[T7470](../upload-integrity/T7470-upload-failure-cascade-delete.md#L26) records the
timeline (pays $3.99 at 04:03, four upload attempts all fail, our own cleanup handler
cascade-deletes the work), and the
[Upload Failure Integrity epic](../upload-integrity/EPIC.md) was filed from that
investigation. The admin impersonation at 05:00 UTC that the residue shows IS that
investigation. So the drift the panel reported is the accounting shadow of a known
incident: a customer paid, got nothing because of our bug, and then vanished from our
records entirely.

That the identity survived only in prose is itself part of the problem this epic fixes. A
financial record should not depend on someone having written a task file.

Deletion path is one of two (both leave identical residue, so the data cannot distinguish
them): the in-app CCPA self-serve delete
([privacy.py:227](../../../../src/backend/app/routers/privacy.py#L227), reachable from
[AccountSettings.jsx:57](../../../../src/frontend/src/components/AccountSettings.jsx#L57))
or a manual [scripts/delete_user.py](../../../../scripts/delete_user.py) run with
`--env prod`. `DELETE /api/auth/user` is ruled out: it never touches the `users` row.
Deletion happened after 05:05 UTC on 2026-08-24, because impersonation requires a live
`users` row.

**User decision 2026-09-03: no refund. The $3.99 stays taken and the chargeback risk is
accepted.** This epic is about never losing the RECORD again, not about this one payment.
(The decision was taken while the payer was still anonymous; the identification above
arrived afterwards and is flagged for the user, not silently acted on.)

**Downstream trap this creates, already flagged on
[T7610](../T7610-stuck-user-outreach.md):** that task's approved win-back copy for this
user says "your credits are intact, and I've added 50 extra credits to your account". The
account no longer exists, so that sentence would be false and the 50-credit pre-send grant
has nothing to grant against.

## Holes uncovered

1. **No local record of an individual payment exists as a financial record.** The only
   local revenue value is `user_segments.total_spent_cents`, a mutable running counter.
   `credit_transactions` carries the PaymentIntent id in `reference_id`, but it is a
   CREDIT ledger (entitlement), not a revenue ledger, and it is purged with the account
   by design ([auth.py:116](../../../../src/backend/app/routers/auth.py#L116)).
2. **Account deletion silently destroys revenue history.** Neither delete path checks for
   payment history, warns, or leaves anything behind.
3. **No record that a deletion happened at all.** We could not determine who deleted the
   account, when, or through which path. The only reason we know the account ever existed
   is that two tables happen to be missed by every delete path.
4. **The reconciliation row is permanently un-healable.** "Adopt Stripe value" calls
   `set_total_spent`, which requires a `user_segments` row
   ([analytics.py:1052](../../../../src/backend/app/analytics.py#L1052)); with none, it
   logs a warning, returns `healed: false`, and the red row returns on the next run. The
   cause reads "Unknown" because the classifier has no deleted-account case.
5. **Admin revenue totals understate reality and cannot self-correct.** Every revenue
   figure is `SUM(user_segments.total_spent_cents)`
   ([admin.py:1318](../../../../src/backend/app/routers/admin.py#L1318),
   [1479](../../../../src/backend/app/routers/admin.py#L1479),
   [1945](../../../../src/backend/app/routers/admin.py#L1945),
   [1983](../../../../src/backend/app/routers/admin.py#L1983)), so a deleted payer removes
   money from the dashboard permanently.
6. **`increment_total_spent` can fail silently.** It is a bare `UPDATE` with no rowcount
   check ([analytics.py:986](../../../../src/backend/app/analytics.py#L986)). A payer with
   no `user_segments` row (the LEFT JOIN note at
   [admin.py:232](../../../../src/backend/app/routers/admin.py#L232) confirms such users
   exist) records nothing and still logs "Incremented".
7. **Customers get no receipt.** `receipt_email` is never set on the PaymentIntent, and
   `charge.receipt_email` was null on every live charge. No receipt means more "I do not
   recognize this charge" disputes and no identity trail once an account is gone.
8. **Drift is only ever seen if a human clicks the button.** Reconciliation is on-demand
   only. This drift sat unnoticed from 2026-08-24 to 2026-09-03.

## How this is normally handled (research, 2026-09-03)

The industry answer is consistent across payments engineering and privacy law: **money
records are append-only and outlive the customer record; personal data is what gets
erased.**

- **Financial records are an explicit carve-out from erasure rights.** GDPR keeps a
  legal-obligation exception (tax and AML retention, commonly 5 to 10 years) where the
  controller has no discretion to erase, and the refusal must be explained to the data
  subject. CCPA/CPRA has the same shape through its transaction-completion and
  legal-obligation exemptions, with the important detail that **exemptions apply per data
  category, not per request**: you delete the marketing and content data and retain the
  financial record. Our current behavior (erase everything including the money record) is
  not what compliance requires, and it is worse for us.
- **Ledgers are immutable and append-only.** Corrections are new postings, never in-place
  edits, and soft-delete-style mutation of financial rows is explicitly rejected by that
  practice, because reverse-engineering a discrepancy is impossible once rows can change.
  Our `total_spent_cents` is the exact anti-pattern: a single mutable number with no
  history, no per-payment rows, and no audit trail.
- **Anonymization sits above the ledger, not inside it.** The standard shape is to keep
  the financial posting intact keyed by an opaque id and strip or detach the identity
  attributes, rather than deleting the posting. Our `user_id` is already an opaque UUID
  carrying no personal data, which makes the pseudonymous tombstone straightforward.
- **Receipts are a dispute-prevention control.** Setting `receipt_email` on the
  PaymentIntent makes Stripe send a receipt on capture; pairing the statement descriptor
  with the receipt is the standard way to cut "unrecognized charge" chargebacks.
- **Reconciliation is scheduled, not manual.** The processor is the source of truth for
  money, the local ledger is reconciled against it on a schedule, and drift raises an
  alert rather than waiting for someone to open a panel.

Sources: [ComplyDog GDPR erasure guide](https://complydog.com/blog/right-to-be-forgotten-gdpr-erasure-rights-guide),
[Legiscope right to erasure](https://www.legiscope.com/blog/right-to-erasure-gdpr.html),
[Clarip CCPA erasure exemptions](https://www.clarip.com/data-privacy/ccpa-erasure-exemptions/),
[Ketch CCPA right to delete](https://www.ketch.com/blog/posts/understanding-the-ccpa-right-to-deletion),
[Formance immutable ledgers](https://www.formance.com/blog/financial-operations/immutable-ledgers-append-only-data-models),
[Modern Treasury data immutability](https://www.moderntreasury.com/learn/data-immutability),
[Stripe receipts](https://docs.stripe.com/payments/advanced/receipts),
[Chargeflow dispute prevention](https://www.chargeflow.io/blog/stop-stripe-disputes).

## Design decisions (locked at filing, subject to the T8620 design gate)

1. **Stripe remains the source of truth for money.** Nothing here changes that. The local
   ledger is a mirror that must be reconcilable against Stripe, not a competing truth.
2. **A new append-only `payments` table in Postgres is the local record of revenue.** One
   row per money event (purchase, refund, dispute adjustment), never updated in place,
   never deleted. This is a track-`postgres` migration.
3. **The row is pseudonymous by construction.** It stores `user_id` (an opaque UUID),
   never email, name, or card data. Deleting the account therefore requires no change to
   the row's contents, which is what makes retention compatible with an erasure request.
4. **Deletion stamps, never removes.** Delete paths set a deletion marker and write an
   audit row; ledger rows are untouched.
5. **`total_spent_cents` survives as a per-user display cache only.** It stops being the
   source for any aggregate revenue figure.
6. **No automated refund behavior anywhere in this epic.** Refund decisions stay a human
   call (see the 2026-09-03 decision above).

## Tasks

Order is dependency order: the record must exist before anything can read it or preserve it.

| ID | Task | Status |
|----|------|--------|
| T8620 | [Append-only payments ledger + Stripe backfill](T8620-payments-ledger.md) | TODO |
| T8630 | [Deletion preserves the financial record and is auditable](T8630-deletion-preserves-financial-record.md) | TODO |
| T8640 | [Reconciliation understands deleted accounts and stops lying about heals](T8640-reconciliation-deleted-account-cause.md) | TODO |
| T8650 | [Revenue totals read the ledger, not the per-user cache](T8650-revenue-totals-from-ledger.md) | TODO |
| T8660 | [Send Stripe receipts (receipt_email on the PaymentIntent)](T8660-stripe-receipt-email.md) | STAGING |
| T8670 | [Scheduled reconciliation with a drift alert](T8670-scheduled-reconciliation-alert.md) | TODO |

## Completion Criteria

- [ ] Every succeeded live PaymentIntent has a matching `payments` row, including the
      2026-08-24 orphan, proven by a reconciliation run reporting 0 unexplained drift
- [ ] Deleting an account (both paths) leaves the `payments` rows intact, stamps the
      deletion, and writes an audit row naming the actor and path
- [ ] The reconciliation panel classifies a deleted-payer row as `account_deleted` and
      offers a terminal acknowledge action instead of a heal that cannot work
- [ ] Admin revenue totals are computed from `payments` and do not change when an account
      is deleted
- [ ] A new live purchase produces a Stripe receipt to the customer's email
- [ ] Drift is detected without a human clicking anything
- [ ] Knowledge docs updated: `backend-services.md` (new table, deletion contract) and
      `persistence-sync.md` if the deletion contract touches the sync seam

## Operational note (not a task in this epic)

Prod Postgres is at `schema_migrations` version 25. **v026 (`users.is_test_account`,
T8110) has not been applied to prod.** Current master's admin queries reference
`u.is_test_account`, so the next prod deploy must run `POST /api/admin/migrate-postgres`
or the admin user list and the reconciliation panel will 500. Any migration in this epic
lands behind that one and inherits the same requirement.
