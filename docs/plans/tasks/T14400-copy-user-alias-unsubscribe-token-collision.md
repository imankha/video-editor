# T14400: copy_user_between_envs.py alias clone fails on email_unsubscribe_token UNIQUE

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-02
**Updated:** 2026-11-02

## Problem

`scripts/copy_user_between_envs.py --to-email <alias>` (T7800 alias clone) fails when the alias
lands in a Postgres that already holds the source account (or a straight copy of it). The users
row is copied column by column, and `users.email_unsubscribe_token` (Postgres migration v037,
`TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::text`) is carried over unchanged. The INSERT's
`ON CONFLICT (user_id)` target doesn't cover that unique index, so the seed aborts with a unique
violation.

Who it hits: the staging gate (`scripts/staging-gate.sh`) seeds its B/C lanes as `--to-email`
alias clones of imankh on staging, and any dev/e2e fixture alias clone. Found by the T11500
worker on 2026-11-02 while extracting the clone logic; T11500's new clone path
(`app/services/account_clone.py`) is not affected.

## Solution

In `copy_postgres_rows`, when `is_alias`, give the alias a fresh `email_unsubscribe_token`
(a new uuid4, the same shape as the column default), next to the existing `google_id` and
`invite_code` neutralization. The function's comment already says every globally-unique users
column must be neutralized for an alias; v037 added one without updating it.

Also worth checking in the same pass: any other UNIQUE column on `users` added after v004
(list them from `_SCHEMA_DDL` in `pg.py` plus the postgres migrations), so the comment's list
is complete.

## Context

### Relevant Files (REQUIRED)
- `scripts/copy_user_between_envs.py` - `copy_postgres_rows`, alias identity rewrite (~line 213)
- `scripts/test_copy_user_between_envs.py` - regression test (create if absent; check existing tests for this script first)

### Related Tasks
- Found by: T11500 (dev account picker)
- Original alias feature: T7800
- Column added by: Postgres migration `v037_email_subscription.py`

### Technical Notes
- Bug depth: test tooling / data scripts. No prod user impact; blocks staging-gate seeding.
- A straight copy (no `--to-email`) keeps the source token, which is correct: it is the same user.
- The unsubscribe token is what email unsubscribe links carry, so the alias must never share
  the source's token (an alias's link would unsubscribe the real user).

## Implementation

### Steps
1. [ ] Failing test: alias clone into a DB already holding the source row hits the unique violation (or a unit test of the row rewrite asserting a distinct token)
2. [ ] Neutralize `email_unsubscribe_token` for aliases; audit other users UNIQUE columns
3. [ ] Test passes; ruff clean

### Progress Log

**2026-11-02**: Filed from the T11500 worker report.

## Acceptance Criteria

- [ ] `--to-email` alias clone succeeds when the source account already exists in the destination
- [ ] The alias's `email_unsubscribe_token` differs from the source's; a straight copy keeps it
- [ ] Red-to-green test
