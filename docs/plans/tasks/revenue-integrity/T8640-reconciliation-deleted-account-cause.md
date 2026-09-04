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

### REQUIRED: the test-account exclusion is one-sided, and it breaks the moment v026 hits prod

Not a hypothetical and not optional. `_load_local_spent_positive`
([admin.py:693](../../../../src/backend/app/routers/admin.py#L693)) applies
`NOT u.is_test_account` to the LOCAL side only. The Stripe side has no such filter, and
`_emails_for` ([admin.py:706](../../../../src/backend/app/routers/admin.py#L706)) has none
either. So a flagged account WITH live Stripe history is dropped from the local map, then
re-enters through the `stripe_only` backfill with `local_cents: 0`, and lands in the report
as a drifted row with cause `unknown`, visually identical to a genuinely deleted payer.

**Known case, already loaded and waiting:** v026 flags `imankh@gmail.com`, which is the
owner's real admin account, and that account has a real live charge (399 cents, 2026-07-23,
`pi_3TwPFMIxob3dHqK044Ye5tgk`). Prod has not run v026 yet, which is the only reason the
panel currently reads "Drifted 1/4". The first prod deploy that runs it turns that into
two drifted rows, drops the local total from $20.97 to $16.98, and reports a net drift of
-$7.98, of which only $3.99 is real.

The imankh row fails DIFFERENTLY from the deleted-payer row, and worse:

| | bigajosue (deleted) | imankh (flagged) |
|---|---|---|
| `user_segments` row | gone | exists, holds the correct 399 |
| Heal outcome | `set_total_spent` returns None, `healed: false` | returns 399, writes 399, **`healed: true`** |
| After heal | row still drifted | row still drifted |

So the flagged-account row is a heal that REPORTS SUCCESS and changes nothing observable,
which is the worst of the three failure shapes on this panel. Fixing the classifier's
causes without fixing this leaves a permanent red row that also lies about being fixed.

**Fix (user directive 2026-09-03: "the flag is to be used by the filter"):** `is_test_account`
is a FILTER input, not a permanent hard exclusion. `list_users` already treats it that way
(`exclude_test` is a request parameter, [admin.py:223](../../../../src/backend/app/routers/admin.py#L223)),
but the reconciliation hardcodes `_test_exclusion(True)`
([admin.py:693](../../../../src/backend/app/routers/admin.py#L693)) with no way to turn it
off. So:

1. The reconciliation endpoint honours the same filter the rest of the admin panel uses,
   defaulting to hiding test accounts like the user table does.
2. Whatever the filter state, resolve the excluded user_id set ONCE and apply it to BOTH
   sides (local map, Stripe aggregate, and `_emails_for`).

That makes both filter states correct and neither produces a phantom row: filtered ON, the
account is absent from both sides, so nothing to drift; filtered OFF, it appears on both
sides with local 399 against Stripe 399, i.e. aligned. A flagged account must never be
dropped from one side while surviving on the other.

**Do NOT solve it by unflagging the account.** User decision 2026-09-03, taken against
these prod numbers (69 users total):

| Metric | imankh | All | Share |
|--------|--------|-----|-------|
| session_started | 194 | 488 | 40% |
| clip_created | 124 | 339 | 37% |
| framing_opened | 55 | 163 | 34% |
| annotation_completed | 74 | 304 | 24% |
| export_completed | 37 | 160 | 23% |
| usage seconds | 62,080 | 267,222 | 23% |

The owner's QA account is a quarter to 40% of every activity number on the dashboard, so
the flag earns its keep on FUNNEL metrics regardless of the trivial revenue involved. The
$3.99 itself is a deliberate one-time live-mode payment test by the owner, not customer
revenue, and is not expected to recur. Keep the account flagged; make the panel filter on
it symmetrically instead of excluding it on one side only.

Note the flag itself is admin-view-only (`_test_exclusion`, the UserTable badge, and the
`markTestAccount` toggle at [admin.py:626](../../../../src/backend/app/routers/admin.py#L626));
it changes nothing about the account's own app experience.

## Acceptance Criteria

- [ ] A payment whose user_id has no local account classifies as `account_deleted`, never
      `unknown`
- [ ] That row does not report as drift after the epic lands (option 1) or is explicitly
      acknowledgeable (option 2)
- [ ] A heal that fails is visible on the row it failed for
- [ ] The panel explains an id-only row instead of showing a bare UUID
- [ ] Classifier stays pure; new fact arrives as a parameter
- [ ] The reconciliation honours the admin test-account FILTER rather than hardcoding
      exclusion, and applies whichever state is active to both the local and Stripe sides
- [ ] A flagged account with live Stripe history is aligned when the filter is off and
      absent when it is on, never unexplained drift in either state, and no heal on this
      panel can report success while changing nothing (regression test seeded with the
      imankh case: flagged, `user_segments` present, local value already correct)
- [ ] Unit tests cover: deleted payer, test-mode-era, refund, dispute, aligned, and a
      deleted payer that ALSO has a refund (account_deleted wins)
