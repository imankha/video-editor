# T6090: `scripts/delete_user.py` orphans the T5840 credit ledger — latent today, live the moment prod runs v019

**Status:** TODO
**Impact:** 4
**Complexity:** 1
**Created:** 2026-07-27
**Source:** Found 2026-07-27 while wiping staging to copy prod accounts down. Observed directly.

## Problem

`scripts/delete_user.py` deletes a user's R2 prefix and their Postgres identity rows, but **never
touches the T5840 credit tables**. Its delete list (`delete_one`, ~lines 145-171) covers
`pending_teammate_shares`, `shares`, `game_storage_refs`, `sessions`, `referrals`, `user_actions`,
`user_segments`, `users` — and stops there.

Consequences:

1. Deleting a user leaves `credits` / `credit_transactions` / `credit_reservations` rows behind
   permanently — orphaned financial records with no owning user row.
2. **Re-creating a user with the same `user_id` silently inherits the stale balance.** This is not
   hypothetical — it happened during the staging wipe on 2026-07-27: after deleting all 7 staging
   accounts and copying `imankh@gmail.com` / `arshia.kalantari@gmail.com` down from prod, they came
   up with **395** and **28** credits respectively. Those are leftover *staging* balances attached
   to freshly-copied *prod* accounts. A test environment that silently reports the wrong balance is
   worse than one that reports zero.

## Why this is Impact 4 and not Impact 2

It is **latent on prod right now** only because prod is still at Postgres `v018` and the credit
tables do not exist there yet. The moment prod runs `v019` (part of the pending deploy), this script
becomes capable of orphaning real financial records on prod. Fixing it before/with that deploy is
the cheap moment.

## Why the blast radius is limited (do not over-scope)

The **application's** deletion paths are correct — verified 2026-07-27, do NOT re-derive:

- `auth.py: _purge_user_data(user_id)` explicitly purges `credits` / `credit_transactions` /
  `credit_reservations` (T5840, and there is a BLOCKING-4 review note in its docstring about
  exactly this).
- `DELETE /api/privacy/delete-account` (CCPA, `privacy.py:124`) and `DELETE /api/auth/user` both
  delegate to `_purge_user_data` and carry explicit comments saying not to duplicate the deletes.

So there is **no user-facing or compliance defect**. The sibling operator scripts are also already
correct: `reset_all_accounts.py:279-280`, `reset-test-user.py:339`, and `delete_all_guests.py:124`
all handle the credit tables. `delete_user.py` is the single one that was missed when T5840 landed.

## Fix

Add the three credit tables to `delete_user.py`'s deletion list, matching what the sibling scripts
already do. Specifics that matter:

- Cover **all three**: `credit_reservations`, `credit_transactions`, `credits`.
- Honour the existing `--dry-run` contract — the script prints a `would delete N rows from {table}`
  line per table, so the new tables must report the same way, not delete silently.
- Mind ordering/FKs — follow whatever order `reset-test-user.py:339` uses rather than inventing one.
- Guard for a **pre-v019 destination**: the tables genuinely do not exist on an env that has not run
  `v019` yet (prod today). Deleting a user on such an env must not crash. `to_regclass` is the
  pattern already used in `copy_user_between_envs.py` for the same situation (commit `2eecb37e`).

## Second deliverable — sweep the orphans that already exist

Staging currently holds orphaned `credits` rows for 7 deleted users, including two synthetic
`e2e_*` ids. Add a way to clean them (a `--sweep-orphans` flag, or a one-off documented query) and
run it against staging. Report the row count removed.

Prod needs no sweep — it has no credit tables yet. Do **not** run anything against prod in this task.

## Must not break

1. `--dry-run` still mutates nothing and still reports every table it would touch.
2. Deleting a user on a **pre-v019** env still succeeds (no crash on missing tables).
3. Shared `games/<hash>.mp4` objects are still never touched (existing invariant, line ~10 of the
   script).
4. The app's own deletion paths are NOT modified — this task is the operator script only.

## Acceptance criteria

- [ ] `delete_user.py --dry-run` reports intended row counts for `credits`,
      `credit_transactions`, and `credit_reservations`.
- [ ] A real delete removes all three, verified by querying Postgres after the run.
- [ ] Deleting a user against a simulated pre-v019 schema (tables absent) completes without error.
- [ ] Existing staging orphans are swept; report the count.
- [ ] A user deleted and then re-created with the same `user_id` starts with **no inherited
      balance** — this is the observed failure and must be the regression pin.

## Knowledge

`.claude/knowledge/backend-services.md` (credits/Postgres). Note at Stage 7 that the credit ledger
is per-`user_id` in Postgres and therefore survives an R2-prefix purge — that is the mental model
slip that caused this, and the next person writing a cleanup tool needs it.
