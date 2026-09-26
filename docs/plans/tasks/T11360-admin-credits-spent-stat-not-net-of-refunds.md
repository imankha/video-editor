# T11360: Admin `credits_spent` Stat Doesn't Net Out Refunds

**Status:** STAGING
**Impact:** 3
**Complexity:** 2
**Created:** 2026-09-25
**Updated:** 2026-09-26

## Problem

Found while investigating Bug 58p: the admin `/users` list showed `credits_spent: 325` for a user
whose 4 failed exports were each fully auto-refunded (`credit_transactions` shows matched
`framing_usage`/`framing_refund` pairs netting to zero for every failed job) and whose real
lifetime net spend was 9 credits (3 game uploads). The 325 figure reads as "this user has burned
325 credits" when the true number is a small fraction of that — this is a gross-deduction sum, not
a net-of-refunds figure, and it's misleading in exactly the situations (support/incident
investigation) where an admin needs an accurate number most. Nearly caused an incorrect
"how much do we owe this user back" judgment call during the Bug 58p response before the ledger
was checked directly.

## Solution

Find the query behind `credits_spent` in the admin users list (`routers/admin.py`, `list_users` /
its supporting SQL) and either net it against matching refund transactions, or — if a gross figure
is intentionally useful for some other admin purpose — add a second, net figure alongside it and
label both clearly. Don't remove information, just make sure at least one number tells the truth
about the user's actual spend at a glance.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/admin.py` — `list_users` (`:266`) and whatever CTE/subquery computes
  `credits_spent`
- `src/backend/app/services/credit_ledger.py` — `credit_transactions` schema (`source` values
  include `framing_usage`, `framing_refund`, etc. — refunds are their own rows, not updates to the
  original)

### Related Tasks
- None (standalone, found incidentally during the modal-export-safety epic's Bug 58p
  investigation but not part of that epic — this is an admin-analytics accuracy issue, unrelated
  domain)

## Implementation

### Steps
1. [ ] Locate the exact SQL producing `credits_spent` today
2. [ ] Decide net-vs-gross-plus-net based on what other admin views assume about this field (check
       for existing callers/assumptions before changing the meaning of an existing field name)
3. [ ] Fix + regression test using a fixture with a deducted-then-refunded transaction pair

### Progress Log

**2026-09-25**: Filed from Bug 58p investigation. Not started.

**2026-09-26 (landed)**: Merged via PR #515 (merge commit `287d8662`), full executable landing
gate (VERIFIED proof, reviewer receipt, green Branch CI, head-pinned merge). Fix location had
moved since filing: the revenue-integrity epic (T8620-T8670, merged same day) relocated this
computation from `admin.py` into `credit_ledger.stats_for_admin()` (off per-file SQLite reads,
T4870) without fixing the underlying gross-vs-net bug. Netted in place — confirmed `credits_spent`
has zero current UI consumers (the admin table shows `total_spent_cents`, a dollar figure from
that same epic, instead), so no second field was needed. Added a drift-guard test asserting the
refund-source list stays in sync with `KEY_PREFIX`, so a future refund source can't silently
reintroduce this exact bug.

## Acceptance Criteria

- [x] A user with fully-refunded failed exports shows an accurate net spend figure in the admin
      users list
- [x] Test covers a deduct+refund pair netting to the correct displayed value
