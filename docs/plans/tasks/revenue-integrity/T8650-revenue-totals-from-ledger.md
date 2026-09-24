# T8650: Revenue totals read the ledger, not the per-user cache

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03

Epic 4/6. See [EPIC.md](EPIC.md). Depends on T8620 (`payments`).

## Problem

Every revenue number in the admin panel is `SUM(user_segments.total_spent_cents)`:

- [admin.py:1318](../../../../src/backend/app/routers/admin.py#L1318) platform breakdown, `revenue_cents` per origin
- [admin.py:1479](../../../../src/backend/app/routers/admin.py#L1479) cohort revenue
- [admin.py:1945](../../../../src/backend/app/routers/admin.py#L1945) filtered dashboard total
- [admin.py:1983](../../../../src/backend/app/routers/admin.py#L1983) unfiltered dashboard total

That column is a per-user cache that deletion zeroes out by removing the row, that a
missing `user_segments` row makes silently un-writable, and that the reconciliation heal
overwrites. Basing the business's revenue reporting on it means the reported number can
only ever drift downward from the truth, permanently and invisibly. Prod is in that state
right now: the dashboard is $3.99 light and nothing in the product can notice.

Note that the deletion case is not hypothetical bookkeeping purity. Deleting a paying
account today changes a historical revenue figure for a month that already closed.

## Solution

Make the `payments` ledger the source for every AGGREGATE revenue figure, and demote
`total_spent_cents` to what it actually is: a per-user display cache on the user table.

### A. Aggregates read the ledger

Replace the four `SUM(total_spent_cents)` reads with `SUM(payments.amount_cents)`, grouped
as each call site requires. Because refunds and lost disputes are negative rows, the sum
is already net, which matches what `total_spent_cents` was defined to mean.

Rules for these queries:

- **Never filter on `account_deleted_at`.** A deleted account's money was still earned.
  The stamp exists to explain a missing user, not to hide revenue.
- **Cohort and origin grouping need a user join** (`user_segments.acquired_at`,
  `origin`). A deleted payer has no segment row, so it lands in no cohort and no origin
  bucket. That is correct for a cohort chart and WRONG for a grand total, so the totals at
  1945 and 1983 must sum the ledger directly with no join, while the grouped views join
  and therefore legitimately exclude what they cannot attribute. Whichever grouped view
  drops rows must show the unattributed remainder rather than quietly losing it, in
  keeping with the project rule that a number must not hide what it excluded.
- **Test-account exclusion** (`_test_exclusion`, [admin.py:92](../../../../src/backend/app/routers/admin.py#L92))
  still applies where it applies today, via the same join, and is skipped where there is
  no user row to join to. Decide and document the grand-total behavior explicitly: an
  internal test purchase on the live key should be excludable, and after deletion it
  cannot be, which is one more reason not to delete such accounts.

### B. The per-user column stays, with an honest name and role

`total_spent_cents` continues to back the user table's per-user spend column. It is a
cache: cheap to read on a page of users without a per-user ledger aggregate. Do not delete
it in this task. Do document at its definition
([pg.py](../../../../src/backend/app/services/pg.py) `_SCHEMA_DDL`, and
[analytics.py:986](../../../../src/backend/app/analytics.py#L986)) that it is a display
cache and that `payments` is the record.

Optional if it comes cheap: have the user table read the ledger per page (the page size is
small and the index is on `(user_id, occurred_at)`), which would let a later task drop the
column entirely. Do not force it here.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` - 1318, 1479, 1945, 1983 (+ the surrounding CTEs)
- `src/backend/app/services/pg.py` - column comment
- `src/backend/app/analytics.py` - 986, 1037 docstrings
- `src/frontend/src/components/admin/` - only if a grouped view gains an "unattributed" line
- `src/backend/tests/` - aggregate correctness incl. a deleted payer

### Related Tasks
- Depends on T8620
- Rebase after T8640 (both touch how the local number is defined)

## Acceptance Criteria

- [ ] Every aggregate revenue figure comes from `payments`
- [ ] Deleting a paying account does not change any total
- [ ] Grouped views that cannot attribute a payment show the remainder instead of dropping
      it
- [ ] A test with a ledger row whose user has no `user_segments` row proves the grand total
      still counts it
- [ ] `total_spent_cents` is documented as a display cache at every definition site

## Implementation notes (2026-09-24)

Backend (`routers/admin.py`): two helpers by `_test_exclusion` —
`_ledger_revenue_total(cur, exclude_test)` (grand total `SUM(payments.amount_cents)`, no
`user_segments` join, test exclusion via a `users` anti-join) and `_LEDGER_REVENUE_BY_USER`
(per-user pre-aggregated subquery LEFT-JOINed into the grouped views, no fanout, GROUP BY
user_id served by `idx_payments_user`). All four `SUM(total_spent_cents)` reads replaced.

**Grand-total decision (UPDATED round 2, 2026-09-24 user decision):** the pulse Revenue card
FOLLOWS the dashboard filters. With no real segment filter it is the platform grand total
(deleted payers included, test excluded) so "deleting a paying account changes no total"
holds; with a real filter (origin/date/paying/...) it is `SUM(payments.amount_cents)` over the
same segment population the Signups number uses (a deleted payer has no segment row, so it can
never match a filter). The per-origin / per-cohort split lives in the channels + cohorts
grouped views, which return `unattributed_revenue_cents` (attributed + unattributed == grand
total). Round 2 also scoped the cohorts remainder to an active `origin` filter
(`_grouped_view_grand_total`) so `/cohorts?origin=X` reconciles within origin X.
(Round 1 had made the headline filter-INDEPENDENT; the user reversed that.)

**Test-account grand-total behaviour (documented):** a test purchase is excluded WHILE the
account's `users` row exists (anti-join) but is counted once that row is deleted — there is no
users row left to recognise it by. One more reason not to delete internal test accounts.

**Deferred to avoid a file conflict:** T8630 owns `services/pg.py`, so the `_SCHEMA_DDL`
`total_spent_cents` "display cache" column comment is NOT added here. The display-cache role
is instead documented in `payments_ledger.bump_total_spent`, at the `list_users` per-user read
in `admin.py`, and in `backend-services.md`.

Docs-only / behavior-preserving? No — this is a behavioral read-side change; proof is the
red-to-green in `qa/t8650-red-green.txt` (10 behavioral tests red on base 1ff3962b for the
intended reason, green after). Frontend: `ChannelsTable`/`CohortGrid` render an "Unattributed"
row when the remainder is nonzero.
