# T8640: Reconciliation understands deleted accounts and stops lying about heals

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03

Epic 3/6. See [EPIC.md](EPIC.md). Depends on T8620 (`payments`) and T8630
(`account_deletions`).

## Problem

The panel that found the incident cannot describe or close it.

**1. The cause is wrong.** `_classify_cause`
([revenue_reconciliation.py:129](../../../../src/backend/app/services/revenue_reconciliation.py#L129))
has five causes: aligned, test_mode_era, dispute, refund, unknown. A deleted payer falls
through to `unknown`, which reads as "we do not know what happened" when in fact we know
exactly what happened. `test_mode_era` cannot catch it either: that branch requires
`pi_count == 0`, and this row has a live PaymentIntent.

**2. The row cannot be closed.** "Adopt Stripe value" calls `set_total_spent`
([analytics.py:1037](../../../../src/backend/app/analytics.py#L1037)), which requires a
`user_segments` row. There is none, so it logs a warning and returns `None`, the endpoint
reports `healed: false` ([admin.py:813](../../../../src/backend/app/routers/admin.py#L813)),
and the red row returns on every subsequent run. Permanent red on a panel is worse than no
panel: it trains the reader to ignore it.

**3. The failure is invisible in the UI.** The heal response counts successes
([admin.py:816](../../../../src/backend/app/routers/admin.py#L816)) but the frontend
([RevenueReconciliation.jsx](../../../../src/frontend/src/components/admin/RevenueReconciliation.jsx))
does not surface a per-row failure, so "Adopt Stripe value" on an impossible row looks
like it worked.

**4. The row is anonymous for the wrong reason.** The user_id renders raw because
`_emails_for` finds no `users` row ([admin.py:706](../../../../src/backend/app/routers/admin.py#L706)),
and `classify_users` still includes the id via the key union
([revenue_reconciliation.py:158](../../../../src/backend/app/services/revenue_reconciliation.py#L158)).
That union is correct and must stay; what is missing is the explanation next to it.

## Solution

### A. A cause for it

Add `DriftCause.ACCOUNT_DELETED = "account_deleted"` and classify it BEFORE `dispute` and
`refund`: if the user_id has no local account (no `users` row) and has live Stripe
history, the deletion is the explanation regardless of what else is true. Priority becomes:
aligned, test_mode_era, account_deleted, dispute, refund, unknown.

`_classify_cause` is a pure function over numbers today and its purity is the reason the
module is testable. Keep it pure: pass the new fact in as a parameter
(`local_account_exists: bool`), computed by the caller from the Postgres read, never by
reaching into a DB from inside the classifier.

### B. A resolution that actually resolves

For an `account_deleted` row, the heal button must not attempt `set_total_spent`. Replace
it with an acknowledge action that records the row as expected and stops it counting as
drift. Two implementation options, decide at design:

1. **Derive from the ledger (preferred).** With T8620 in place, an `account_deleted` row's
   local truth is `SUM(payments.amount_cents)` for that user_id, which the backfill made
   equal to the Stripe net. The row then reconciles by construction and needs no
   acknowledge gesture at all: it simply stops being drifted once the reconciler compares
   against the ledger instead of `total_spent_cents`. This is the honest fix and it
   deletes UI rather than adding it.
2. **Explicit acknowledge.** If the reconciler keeps comparing against
   `total_spent_cents`, add a durable acknowledgement (a row in `account_deletions` is the
   natural home, e.g. `reconciled_at`) so the panel can show the row as explained rather
   than drifted.

Option 1 is the recommendation and it is why this task sequences after T8620. Take option
2 only if the design gate rejects reading the ledger here.

### C. Make a failed heal visible

Regardless of the above: when `heal` returns `healed: false` for a user id, the UI must
say so on that row instead of silently refreshing. A gesture that cannot succeed should
either be absent or report its failure.

### D. Show what is known about the anonymous row

Where the email is missing, render the id with a short explanation ("account deleted
2026-08-24") sourced from `account_deletions`, rather than a bare grey UUID. If no
deletion row exists (payments predating T8630), say that too: "no local account".

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/revenue_reconciliation.py` - 38 (enum), 129 (`_classify_cause`), 149 (`classify_users`)
- `src/backend/app/routers/admin.py` - 687 (`_load_local_spent_positive`), 715 (`_compute_reconciliation`), 775 (heal)
- `src/frontend/src/components/admin/RevenueReconciliation.jsx` - cause chip, per-row failure, id rendering
- `src/frontend/src/stores/adminStore.js` - heal result handling
- `src/backend/tests/test_revenue_reconciliation*.py` - classifier is pure, so cases are cheap
- `src/frontend/src/stores/adminStore.reconciliation.test.js`, `RevenueReconciliation.test.jsx`

### Related Tasks
- Depends on T8620, T8630
- Overlaps T8650 (both decide what the local number IS); T8650 owns the aggregate reads,
  this task owns the per-user reconciliation view. Land T8650 second and rebase.

### Technical Notes
- Keep the `set(local) | set(stripe_agg)` union in `classify_users`. It is what surfaced
  this incident in the first place.
- The test-account exclusion in `_load_local_spent_positive`
  ([admin.py:693](../../../../src/backend/app/routers/admin.py#L693)) is applied to the
  LOCAL side only, so a test account with live Stripe history would appear as a
  Stripe-only row with local 0, indistinguishable in shape from a deleted payer. Not the
  cause of this incident (that id has no `users` row at all, so it is not a test account),
  but the same visual and worth resolving while in here: either exclude those ids from the
  Stripe side too, or label them.

## Acceptance Criteria

- [ ] A payment whose user_id has no local account classifies as `account_deleted`, never
      `unknown`
- [ ] That row does not report as drift after the epic lands (option 1) or is explicitly
      acknowledgeable (option 2)
- [ ] A heal that fails is visible on the row it failed for
- [ ] The panel explains an id-only row instead of showing a bare UUID
- [ ] Classifier stays pure; new fact arrives as a parameter
- [ ] Unit tests cover: deleted payer, test-mode-era, refund, dispute, aligned, and a
      deleted payer that ALSO has a refund (account_deleted wins)
