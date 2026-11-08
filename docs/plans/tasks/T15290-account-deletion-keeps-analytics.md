# T15290: Account deletion keeps analytics: hashed email, attribution kept, deletion visible in the admin

**Status:** WIP
**Impact:** 7
**Complexity:** 4
**Tier:** L (postgres migration, Migration agent; backend + admin read)
**Created:** 2026-11-07
**Updated:** 2026-11-07

## Ruling

Owner ruling 2026-11-07 on what account deletion means:

1. The user loses all user data.
2. Their email is replaced with a hash, so the record is anonymised.
3. Analytics on them is kept, and analytics knows they deleted their account.

## Problem

The code does not match the ruling (checked 2026-11-07):

- The deletion paths (`routers/privacy.py` `delete_account`, `delete_user.py`,
  `copy_user_between_envs.py`) run `DELETE FROM users`. No hashed email is kept anywhere
  (`account_deletions` has user id, date, actor, path, payments, note; no email hash).
- `analytics.deidentify_user_segments` clears `utm_source`, `utm_medium`, `utm_campaign`,
  `utm_content`, `utm_term`, `click_source`, `current_session_start`, `last_active_at` and
  `total_usage_seconds` (T8630 round 4). Attribution analytics on a deleted user is lost, against
  point 3. The arrival sport (T14930, `utm_content`) would also vanish on deletion.
- The admin infers "deleted" from `last_active_at IS NULL` (`analytics_journey.py`), not from the
  deletion record.

## Solution

- **Hashed email.** Keep a keyed hash of the normalised (trimmed, lower-cased) email on the
  deletion record: `account_deletions.email_hash` (HMAC-SHA256 with a server secret, never a bare
  SHA-256, which a dictionary of emails reverses). Written in the same transaction, before the
  `users` row goes. Use: recognise a returning person at sign-up as `returning_after_deletion`
  (analytics only; never restore data, never block sign-up).
- **Keep analytics.** Shrink `_DEIDENTIFY_SEGMENT_COLUMNS` to the live-session fields only
  (`current_session_start`). Keep `utm_*`, `click_source`, `last_active_at`, `total_usage_seconds`
  and (when T15010 lands) `landing_path`. Revisit the T8630 round-4 rationale in the task file and
  record why the owner ruling replaces it (no column identifies a person once the email is a
  keyed hash and the user's data is gone).
- **Deletion visible.** Admin reads (Journey users list, user detail, Channels, Landing page table
  when present) take "deleted" from `account_deletions`, not from `last_active_at IS NULL`, and show
  it as a status chip; dimension tables gain a "deleted" count column.
- Privacy page copy: say that anonymised usage analytics is kept after deletion.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` - `_DEIDENTIFY_SEGMENT_COLUMNS`, `deidentify_user_segments`
- `src/backend/app/routers/privacy.py` - `delete_account`
- `src/backend/app/services/account_deletions.py` - `record_account_deletion` takes the hash
- `src/backend/scripts/delete_user.py`, `copy_user_between_envs.py` - the other deletion paths
- `src/backend/app/migrations/postgres/` (next free version) and `src/backend/app/services/pg.py` `_SCHEMA_DDL`
- `src/backend/app/services/analytics_journey.py`, `src/backend/app/routers/admin.py` - deleted from the record
- `src/frontend/src/components/admin/UserDetailPanel.jsx`, `DimensionTable.jsx`
- `src/landing/src/pages/privacy*` - the copy line
- Tests: deletion keeps attribution columns, writes the hash, hash is keyed; admin reads deleted from the record

### Related Tasks
- Same group as T14930 and T15010 (both add attribution that must survive deletion).
- Revisits: T8630 rounds 4 and 5.

## Acceptance Criteria

- [ ] After a real deletion: no `users` row, no user data in R2 or local, `account_deletions.email_hash` set, `user_segments` keeps `utm_*`, `click_source` and `landing_path`.
- [ ] The hash is keyed: the same email under a different secret gives a different value (test).
- [ ] A new sign-up whose email hash matches a deletion is marked `returning_after_deletion` in analytics and nothing else changes.
- [ ] Admin user list and detail show "deleted" from `account_deletions`; dimension tables show a deleted count.
- [ ] Migration applies on dev, staging and prod via the admin endpoint; fresh DDL matches.
