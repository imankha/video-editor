# Epic: Data Integrity & Persistence Hardening

**Goal:** Make it impossible for user data or credits to be silently lost. Every write path must be atomic, every failure must be visible, every recovery must be automatic.

**Phase:** Pre-production — restructure before live users, not after.

## Architecture Change

### Current: Shared auth.sqlite + per-profile database.sqlite

```
auth.sqlite (shared, ALL users)
├── users (identity + credits + stripe_customer_id)
├── sessions
├── otp_codes
├── admin_users
└── credit_transactions

user_data/{user_id}/profiles/{profile_id}/
└── database.sqlite (games, clips, projects, exports, working_videos, etc.)
```

**Problems:**
- Credit operations lock ALL users (shared file)
- Credits (auth.sqlite) and export_jobs (profile DB) can't share a transaction
- Guest migration loses credits (different DB from merge target)
- Quest reward double-grant (check-then-act across connections)

### Target: auth.sqlite + per-user user.sqlite + per-profile database.sqlite

```
auth.sqlite (shared, cross-user lookups ONLY)
├── users (identity: user_id, email, google_id, verified_at, created_at, last_seen_at)
├── sessions (session_id → user_id, ephemeral)
├── otp_codes (email-keyed)
└── admin_users

user_data/{user_id}/
├── user.sqlite (user-level, NOT profile-level)
│   ├── credits (balance)
│   ├── credit_transactions (audit ledger)
│   ├── credit_reservations (pending export deductions)
│   ├── stripe_customer_id (in user_meta or dedicated table)
│   └── pending_migrations (T820 recovery)
│
└── profiles/{profile_id}/
    └── database.sqlite (unchanged — games, clips, projects, exports)
```

### What moves where

| Data | From | To | Reason |
|------|------|----|--------|
| `credits` (balance) | auth.sqlite `users.credits` | user.sqlite `credits` table | Eliminate cross-user lock contention |
| `credit_transactions` | auth.sqlite | user.sqlite | Same DB as balance = atomic |
| `stripe_customer_id` | auth.sqlite `users.stripe_customer_id` | user.sqlite `user_meta` | User-scoped, never cross-user lookup |
| `pending_migrations` | (new) | user.sqlite | User-scoped recovery data |
| `credit_reservations` | (new) | user.sqlite | Atomic reserve/confirm for exports |

### What stays in auth.sqlite

| Data | Reason |
|------|--------|
| `users` (identity columns only) | Email/google_id UNIQUE constraints, cross-user login lookup |
| `sessions` | session_id → user_id translation on every request |
| `otp_codes` | Email-keyed, cross-user |
| `admin_users` | Global admin list |

### Cross-DB Atomicity: Credit Reservation Pattern

Credits (user.sqlite) and export_jobs (profile database.sqlite) are still separate files. Instead of attempting cross-DB transactions, use a reservation pattern:

```
1. reserve_credits(user_id, amount, job_id)     → user.sqlite: INSERT credit_reservations, UPDATE credits
2. create_export_job(job_id, project_id)         → database.sqlite: INSERT export_jobs
3. confirm_reservation(job_id)                   → user.sqlite: DELETE reservation, INSERT credit_transaction

On failure at step 2:
   release_reservation(job_id)                   → user.sqlite: DELETE reservation, UPDATE credits += amount

Startup recovery:
   Any reservation older than 60s with no matching export_job → auto-release
```

Each step is atomic within its own SQLite file. The reservation acts as a "hold" that can be released if the export job never materializes.

### Admin Panel Impact

Admin stats (`get_all_users_for_admin`, `get_credit_stats_for_admin`) currently query auth.sqlite. After migration:
- User list: still from auth.sqlite (identity data stays)
- Credit stats: must scan user.sqlite files OR maintain denormalized totals in auth.sqlite
- Recommendation: keep a `credit_summary` column on auth.sqlite `users` table, updated async after each credit operation. Exact balance lives in user.sqlite; auth.sqlite has an eventually-consistent copy for admin aggregation.

## Task Dependency Chain

```
T920 (User-Level DB)
 │
 ├── T880 (Quest Double-Grant)        — UNIQUE constraint in user.sqlite
 ├── T890 (Export Atomicity)          — credit reservation pattern
 │
 ├── T820 (Guest Migration)           — pending_migrations + credit transfer in user.sqlite
 │
 ├── T910 (R2 Restore Retry)          — extend restore logic to user.sqlite
 │
 └── T900 (FK Cascade Gaps)           — independent, profile DB only
```

## Tasks

| # | ID | Task | Status | Impact | Cmplx | Depends On |
|---|-----|------|--------|--------|-------|------------|
| 1 | T920 | [User-Level DB](T920-user-level-db.md) | TODO | 9 | 6 | — |
| 2 | T880 | [Quest Reward Double-Grant](T880-quest-reward-double-grant.md) | TODO | 8 | 2 | T920 |
| 3 | T890 | [Export Transaction Atomicity](T890-export-transaction-atomicity.md) | TODO | 7 | 4 | T920 |
| 4 | T820 | [Guest Migration Data Loss](T820-guest-migration-data-loss.md) | TODO | 10 | 6 | T920 |
| 5 | T910 | [R2 Restore Retry](T910-r2-restore-retry.md) | TODO | 8 | 3 | T920 |
| 6 | T900 | [FK Cascade Gaps](T900-fk-cascade-gaps.md) | TODO | 5 | 3 | — |
