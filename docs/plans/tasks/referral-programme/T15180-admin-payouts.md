# T15180: Admin payouts: owed per referrer, mark paid, Stripe Connect decision

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Tier:** M for the admin view and gesture; the Stripe Connect part is a design-gated spike inside this task
**Created:** 2026-11-05
**Updated:** 2026-11-05

Epic: [referral-programme/EPIC.md](EPIC.md). Epic task 4 of 5.

## Problem

Owed balances exist (T15150) but nothing lets the owner pay them and record it. The owner asked
whether Stripe can let referrers access funds directly; the answer depends on volumes nobody has
measured yet.

## Solution

- **Admin view** "Referral payouts": every referrer with a nonzero balance, owed / pending / paid,
  referred count, link to the user. CSV export of the owed list for a manual payment run.
- **Mark paid** gesture: amount, method (manual transfer, PayPal, Stripe transfer, credits),
  reference; appends a `referral_payouts` row (T15150's only writer). Partial payments allowed.
- **Stripe Connect decision** (spike, design-gated): Express accounts can receive transfers, but
  each referrer must onboard (identity, bank), payouts carry fees, and tax reporting applies above
  thresholds. The spike reads the first two months of owed totals and recommends: manual payouts
  (default while monthly owed is small), credits as an opt-in alternative, or Connect once a
  threshold is crossed. Implementation of Connect is a separate task filed from the spike.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/admin/ReferralPayoutsPanel.jsx` (new) + test
- `src/backend/app/routers/admin.py` (owed list is T15150's; add `POST /api/admin/referrals/payouts`)
- `src/backend/app/services/referral_earnings.py` (record_payout, cursor-taking)
- `docs/plans/tasks/referral-programme/T15180-stripe-connect-spike.md` (spike output)

### Related Tasks
- Depends on: T15150
- Related: T8620 payments ledger (append-only pattern), credit_ledger (if credits are offered)

### Technical Notes
- Mark paid is the one write; it is a gesture with a confirm step and never reactive.
- A payout recorded in credits goes through `credit_ledger.grant` with an idempotency key derived
  from the payout row, so a retry cannot double-grant.

## Implementation

### Steps
1. [ ] Failing tests: owed list ordering, mark paid appends and reduces owed, partial payment, credits path idempotent
2. [ ] Panel + endpoint
3. [ ] Spike document with measured owed totals and the recommendation

### Progress Log

**2026-11-05**: Filed.

## Acceptance Criteria

- [ ] Owed list matches T15150 for seeded data; CSV export round-trips
- [ ] Mark paid reduces owed by the amount and is visible on the referrer page within a reload
- [ ] Spike document states the threshold and the fee arithmetic with sources
