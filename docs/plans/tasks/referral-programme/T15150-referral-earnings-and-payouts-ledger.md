# T15150: Referral earnings read model + payouts ledger

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Tier:** L (one new Postgres table, Migration agent; a money read model that two UIs depend on)
**Created:** 2026-11-05
**Updated:** 2026-11-05

Epic: [referral-programme/EPIC.md](EPIC.md) (mechanism and directives live there; this file does
not repeat them). Epic task 1 of 5; everything else reads what this builds.

## Problem

Nothing computes what a referrer is owed. `referrals` says who brought whom, `payments` says who
paid what and when, `users.created_at` dates the sign-up; the 50%-for-60-days rule is a join over
the three that does not exist, and there is no record of what has been paid out.

## Solution

- Read model `services/referral_earnings.py`: for a referrer, every referred user (`referrals`,
  test accounts excluded via the admin predicate, self-referral excluded), each with purchases from
  the `payments` ledger dated within `REFERRAL_WINDOW_DAYS = 60` of the referred user's
  `created_at`, netted against refunds and lost disputes on the same charge, times
  `REFERRAL_SHARE = 0.5`. Returns `{accrued_cents, pending_cents, paid_cents, owed_cents,
  referred: [{signed_up_at, window_ends_at, purchases, share_cents}]}`. "Pending" is accrual still
  inside the Stripe dispute horizon (`PAYOUT_HOLD_DAYS`, constant); "owed" is accrued minus
  pending minus paid.
- New table `referral_payouts` (postgres, next free version): `id, referrer_id, amount_cents,
  method, reference, paid_at, created_by`; append-only like `payments`; sole writer is the admin
  mark-paid gesture (T15180). Nothing else is stored: accrual is always recomputed from the ledger
  so a refund after payout shows as a negative balance rather than a silently wrong total.
- `GET /api/referrals/earnings` (session user) and `GET /api/admin/referrals/owed` (admin, all
  referrers with a nonzero balance).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/referral_earnings.py` (new)
- `src/backend/app/services/referral_constants.py` (new: share, window, hold)
- `src/backend/app/migrations/postgres/v0NN_referral_payouts.py` (new) + `_SCHEMA_DDL` in `pg.py`
- `src/backend/app/routers/referrals.py` (new) and `routers/admin.py` (owed endpoint)
- `src/backend/tests/test_referral_earnings.py` (new)

### Related Tasks
- Depends on: T15070 (end-card code, STAGING), T8620 payments ledger (DONE)
- Blocks: T15160, T15180, T15190
- Reads the same predicate as T14910's gates (test exclusion, refund netting)

### Technical Notes
- Money is read from `payments` only (T8650 rule), never from `user_segments.total_spent_cents`.
- Deleted referred accounts keep their pseudonymous `payments` and `user_segments` rows, so a
  payout owed on them survives the deletion (T8630).
- Constants are plain module values; changing the share is a one-line edit with a reason.

## Implementation

### Steps
1. [ ] Failing tests: window edges (day 60 inclusive), refund netting, self-referral, test account,
       deleted referred user, pending vs owed, payout subtraction
2. [ ] Constants + read model
3. [ ] Migration + DDL + Migration agent review
4. [ ] Endpoints

### Progress Log

**2026-11-05**: Filed from the owner's referral-programme request.

## Acceptance Criteria

- [ ] A $12.99 purchase on day 59 accrues $6.50 (rounded by the stated rule); on day 61 accrues $0
- [ ] A refund inside the window removes the matching share; a refund after payout shows a negative owed balance
- [ ] Self-referral and test accounts accrue nothing
- [ ] `referral_payouts` has one writer and a DB trigger forbidding UPDATE/DELETE (T8630 pattern)
- [ ] Owed totals from the user endpoint and the admin endpoint agree for the same referrer
