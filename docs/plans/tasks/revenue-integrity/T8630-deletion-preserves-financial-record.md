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
    path           TEXT NOT NULL,   -- 'privacy_endpoint' | 'delete_user_script' | 'reset_test_account' | 'reset_test_user_script' | 'copy_user_between_envs'
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
- Round 2 (2026-09-25): `user_usage_daily` is analytics-only, so every real delete path now
  purges it (`privacy.delete_account`, `_reset_test_account`, `scripts/delete_user.py`,
  `scripts/reset-test-user.py`, `scripts/copy_user_between_envs.py`). `impersonation_audit`
  is a security log and is RETAINED, alongside `account_deletions`, as the forensic trail.
- Round 3 (2026-09-25): two fixes after the proof verifier returned MORE_PROOF_REQUIRED at
  e15a9ce8.
  1. **Bulk delete half-delete.** `scripts/delete_user.py::main` committed ONCE after the
     whole loop, so a later target failing in Postgres (or a transient R2 error) rolled back
     every earlier target's `DELETE` AFTER its irreversible storage purge had already run,
     leaving half-deleted accounts. Fix: `delete_one` is split into `delete_one_postgres`
     (all PG work, no commit, returns bug-attachment R2 keys) and `purge_user_storage`
     (R2 prefix + bug attachments + local rmtree); `main` commits EACH user's Postgres work
     in its own transaction BEFORE that user's storage purge. The `--force-paid` pre-pass
     still refuses before any deletion. **Decision (storage-purge failure after a user's
     commit):** log loudly, record the target, continue to the next, and exit non-zero at the
     end. The DB side is already consistent (row gone, audit written) and leftover storage can
     be re-purged by re-running. A per-user Postgres failure rolls back only that target
     (left fully intact) and likewise continues to the next target.
  2. **Bug reports anonymized on real deletions.** `app/services/bug_reports.py::
     anonymize_bug_reports` keeps the report TEXT (`description`) plus `build`/`status`/
     `duplicate_of`/`admin_notes`/`client_report_id`/timestamps, and CLEARS the identifying/
     device/attachment columns: `reporter_email`, `page_url`, `user_agent`, `editor_context`,
     `actions`, `console_logs`, `screenshot_r2_key`, `logs_r2_key`. `bug_reports` has NO
     `user_id` column (rows are keyed by `reporter_email`), so there is no user_id link to
     keep or null. The referenced R2 screenshot/console-log objects (global keys
     `{env}/bugs/{id}/...`, not under the user prefix) are deleted AFTER the per-user commit.
     Applied to the three REAL delete paths (`privacy.delete_account`, `delete_user.py`,
     `copy_user_between_envs.py`); **NOT** the two NUF test-reset paths (`_reset_test_account`,
     `reset-test-user.py`) -- the same email logs straight back in and its own historical
     reports stay intact.
     - Also purged on real deletions: the user's `otp_codes` rows (short-lived login codes,
       keyed by email) and the user's `share_claims` rows. **Decision (share_claims):**
       `claimer_user_id` is `NOT NULL`, so the row is DELETED rather than nulled -- a deleted
       user's claim link serves no purpose and removing it drops the pseudonymous link
       entirely. (`copy_user_between_envs.py` already purged `otp_codes`.)
     - Copy: the retained-data lists in `docs/legal/privacy-policy.md`,
       `docs/legal/data-retention-policy.md`, and `PrivacyPolicy.jsx` gain one line stating the
       text of submitted bug reports is kept to fix problems, with email/device details/
       attachments removed. The three existing categories are unchanged; `AccountSettings.jsx`
       stays exactly as ruling C.

## Implementation

### Steps
1. [x] Migration: `account_deletions` table (+ `_SCHEMA_DDL`) -- v031, `id BIGSERIAL` PK
2. [x] Stamp `payments.account_deleted_at` on the real delete paths that should stamp
       (privacy_endpoint, delete_user_script; reset_test_account audits but does not stamp,
       per the design's Approved ruling 1)
3. [x] Write the audit row on all three real delete paths
4. [x] `--force-paid` guard in `delete_user.py`, including the bulk modes
5. [x] Privacy copy: policy doc + in-app confirmation (4 surfaces)
6. [x] Tests (`tests/test_t8630_deletion_audit.py`, 24 tests; proof: `qa/t8630-red-green.txt`)

## Acceptance Criteria

- [x] Deleting an account with payments leaves every `payments` row intact, stamped with
      `account_deleted_at`
- [x] Every `users` row deletion writes exactly one `account_deletions` row naming actor
      and path, across all five real delete paths: `privacy_endpoint`, `delete_user_script`,
      `reset_test_account`, `reset_test_user_script`, and `copy_user_between_envs`
- [x] `delete_user.py` refuses a paying account without `--force-paid`, and refuses a bulk
      run containing one before deleting anything
- [x] The in-app delete confirmation and the privacy policy both state that transaction
      records are retained, with the reason
- [x] Re-running the 2026-09-03 investigation questions against a freshly deleted test
      account answers all of them from tables: who deleted it, when, through which path,
      and how much money it had
- [x] (Round 3) A bulk `delete_user.py` run where one target fails in Postgres leaves every
      earlier COMMITTED target fully deleted (row gone, audit row, ledger stamped if paying,
      storage purged), leaves the failing target fully intact (row, storage, no audit), and
      continues to later targets, exiting non-zero
- [x] (Round 3) A real account deletion anonymizes the user's `bug_reports` rows (keeps the
      text, clears every identifying/device/attachment column) and deletes the referenced R2
      screenshot/log objects; the user's `otp_codes` and `share_claims` rows are purged
