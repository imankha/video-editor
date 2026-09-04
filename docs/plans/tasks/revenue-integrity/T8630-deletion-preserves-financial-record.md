# T8630: Deletion preserves the financial record and is auditable

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-03
**Updated:** 2026-09-03

Epic 2/6. See [EPIC.md](EPIC.md) for the incident, the research, and the locked design
decisions. Depends on T8620's `payments` table existing.

## Problem

Two things are wrong with account deletion today, and the 2026-09-03 investigation hit
both at once.

**1. It destroys the revenue record.** Both delete paths remove `user_segments` (where
`total_spent_cents` lives) and `credit_transactions` (where the PaymentIntent ids live),
with no check for payment history and no warning:

- [privacy.py:227](../../../../src/backend/app/routers/privacy.py#L227)
  `DELETE /api/privacy/delete-account`, the in-app CCPA self-serve delete, reachable from
  [AccountSettings.jsx:57](../../../../src/frontend/src/components/AccountSettings.jsx#L57)
- [scripts/delete_user.py](../../../../scripts/delete_user.py), manual, `--env prod` capable

(`DELETE /api/auth/user` at [auth.py:239](../../../../src/backend/app/routers/auth.py#L239)
never touches the `users` row, so it is not part of this problem, but it shares
`_purge_user_data` and must not regress.)

**2. It leaves no record that it happened.** After the prod deletion we could not
determine who deleted the account, when, or through which path. The only reason we could
prove the account had EXISTED is that two tables happen to be missed by every delete path
(`user_usage_daily` and `impersonation_audit`). Being able to reconstruct an incident from
tables nobody remembered to clean is luck, not an audit trail.

The research (EPIC.md) is unambiguous that this is backwards: financial records are the
category that erasure rights explicitly carve out, and the deletion event itself is
exactly what a controller is expected to be able to evidence.

## Solution

### A. Ledger rows survive, and get stamped

No delete path may remove `payments` rows. On deletion, stamp
`payments.account_deleted_at = now()` for that user_id. That stamp is metadata about the
account, not about the money: it never filters revenue queries (T8650), it exists so a
reader knows why the user_id resolves to nothing.

This is safe under an erasure request precisely because T8620 made the row pseudonymous:
`user_id` is an opaque UUID and the row carries no email, name, or card data.

### B. A deletion audit row

New Postgres table (same migration as the stamp, or the next free version):

```sql
CREATE TABLE IF NOT EXISTS account_deletions (
    user_id        TEXT PRIMARY KEY,
    deleted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor          TEXT NOT NULL,   -- 'self' | 'admin' | 'script'
    path           TEXT NOT NULL,   -- 'privacy_endpoint' | 'delete_user_script' | 'reset_test_account'
    had_payments   BOOLEAN NOT NULL,
    net_cents      INTEGER NOT NULL DEFAULT 0,  -- SUM(payments.amount_cents) at deletion time
    note           TEXT
);
```

No email column. The point of this table is "an account with this id was deleted, by whom,
through which path, and did it have money attached", which is answerable without personal
data. Write it from every path that deletes a `users` row, inside the same transaction as
the delete where possible.

### C. Deleting a paying account requires intent

- `scripts/delete_user.py`: before deleting, query the ledger. If the target has any
  `payments` rows, print a loud block listing net revenue, the payment ids, and the fact
  that the ledger will be RETAINED, then refuse unless a new explicit `--force-paid` flag
  is passed. `--all` and `--all-except` must apply the same check per user and refuse the
  whole run if any target has revenue and the flag is absent (fail before the first
  deletion, not halfway through).
- The privacy endpoint does NOT gain a block. A user exercising an erasure right is not
  something we refuse. It gains the audit row, the ledger stamp, and a log line naming the
  retained financial record.

### D. Say so in the privacy copy

The privacy policy and the in-app delete confirmation must state that transaction records
are retained after deletion, and why (tax and accounting obligation). Retaining data
silently is the compliance problem; retaining it with a stated basis is the compliance
answer, and the research notes the refusal-with-explanation duty explicitly. Coordinate
wording with the existing T1740 privacy documents rather than inventing a second voice.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/postgres/v0NN_account_deletions.py` - new
- `src/backend/app/services/pg.py` - `_SCHEMA_DDL`
- `src/backend/app/routers/privacy.py` - 227-280
- `src/backend/app/routers/auth.py` - `_purge_user_data` (74), `_reset_test_account` (142)
- `scripts/delete_user.py` - 168-225 (delete_one), main/arg parsing
- `src/frontend/src/components/AccountSettings.jsx` - confirmation copy
- Privacy policy doc (T1740 output) - retention wording
- `src/backend/tests/` - deletion preserves ledger, writes audit, script refuses

### Related Tasks
- Depends on T8620 (`payments` table, `account_deleted_at` column)
- Feeds T8640 (the reconciler reads `account_deletions` to classify a row honestly)

### Technical Notes
- `_purge_user_data` is shared by three callers. Put the ledger stamp and audit write in
  the two callers that actually delete the `users` row, not in `_purge_user_data` itself,
  which is also used by the test-cleanup endpoint that leaves the account alive.
- Deliberately NOT in scope: deleting the two residue tables (`user_usage_daily`,
  `impersonation_audit`). Once `account_deletions` exists, cleaning them is a separate
  decision, and today they are the only forensic trail we have.

## Implementation

### Steps
1. [ ] Migration: `account_deletions` table (+ `_SCHEMA_DDL`)
2. [ ] Stamp `payments.account_deleted_at` on both real delete paths
3. [ ] Write the audit row on both real delete paths
4. [ ] `--force-paid` guard in `delete_user.py`, including the bulk modes
5. [ ] Privacy copy: policy doc + in-app confirmation
6. [ ] Tests

## Acceptance Criteria

- [ ] Deleting an account with payments leaves every `payments` row intact, stamped with
      `account_deleted_at`
- [ ] Every `users` row deletion writes exactly one `account_deletions` row naming actor
      and path
- [ ] `delete_user.py` refuses a paying account without `--force-paid`, and refuses a bulk
      run containing one before deleting anything
- [ ] The in-app delete confirmation and the privacy policy both state that transaction
      records are retained, with the reason
- [ ] Re-running the 2026-09-03 investigation questions against a freshly deleted test
      account answers all of them from tables: who deleted it, when, through which path,
      and how much money it had
