# T8657: Admin "paying" filter selects users from the ledger, not the cache

**Status:** WIP
**Impact:** 3
**Complexity:** 1
**Created:** 2026-09-24
**Updated:** 2026-09-24

Epic follow-up. See [EPIC.md](EPIC.md). Found by the T8650 proof verifier on 2026-09-24. The user
asked for it to be filed and done. Depends on T8650 being merged, since both change the same
code in `admin.py`.

## Problem

After T8650, every admin revenue total reads the `payments` ledger. But the dashboard's
`filter=paying` segment still picks its users with `s.total_spent_cents > 0` (admin.py, near
the pulse query), and then sums their ledger revenue. That mixes two sources.

This is reproducible: user A has ledger 1000 and cache 1000; user B has ledger 500 and cache 0.
The "paying" view shows 1000, while the unfiltered view shows 1500.

Since T8620 the cache moves in the same transaction as each ledger insert, so live users agree.
The cache can still differ through the reconciliation "adopt Stripe value" heal, or for users
whose history arrives only through the backfill (the backfill does not touch the cache by design).

## Solution

Define "paying" from the ledger: a user is paying when their net ledger total is above 0,
i.e. `EXISTS`/`IN` against `SELECT user_id FROM payments GROUP BY user_id HAVING SUM(amount_cents) > 0`,
or a join against the existing per-user pre-aggregated ledger subquery. Keep it greppable, and
reuse T8650's `_LEDGER_REVENUE_BY_USER` rather than adding a third copy.

Check the other readers of `total_spent_cents > 0` as a *selector* (not a display): the user
list's paying filter and the dashboards' paying segment. Move each one that decides who counts
as a payer onto the same ledger predicate. Leave pure per-user display reads alone.

## Acceptance Criteria

- [ ] With cache and ledger in disagreement (the repro above), the "paying" segment's user count
      and revenue match the ledger. Fails before the change, passes after.
- [ ] Every selector deciding "is this user a payer" reads the ledger (grep-verified)
- [ ] Test-account exclusion is unchanged
