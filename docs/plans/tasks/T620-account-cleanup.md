# T620: Automated Cleanup of Abandoned/Dormant Accounts

**Status:** TODO
**Impact:** 5
**Complexity:** 5
**Trigger:** High R2 storage fees
**Created:** 2026-03-20
**Updated:** 2026-03-20

## Problem

Guest accounts accumulate over time — each browser visit creates a UUID user with auth DB rows, R2 profile data, and a local SQLite database. Authenticated users who never pay and stop visiting also consume R2 storage indefinitely.

## Solution

Scheduled cleanup job (nightly cron or Cloudflare Worker — NOT a long-running server task) that uses `last_seen_at` to identify and delete inactive accounts.

### Account Tiers

| Tier | Criteria | Inactive Threshold | Action |
|------|----------|-------------------|--------|
| Abandoned guest | No email, no games | 7 days | Delete immediately |
| Inactive guest | No email, has games | 30 days | Delete |
| Dormant free user | Has email, never paid | 90 days | Delete with email warning |
| Dormant paid user | Has email, has paid | 180 days | Email warning, delete after 30 more days |

### Cleanup Scope Per Account
- Auth DB: `users`, `sessions`, `credit_transactions` rows
- R2: All objects under `{env}/users/{user_id}/`
- Local: `user_data/{user_id}/` folder (if running on server)

### Execution Options
1. **Cloudflare Worker** (preferred) — scheduled trigger, reads auth.sqlite from R2, deletes R2 objects directly. No server load.
2. **Nightly cron on Fly.io** — run during low-usage hours. Simple but adds server load.
3. **Manual script** — `scripts/reset_all_accounts.py` already exists for full wipe; extend with TTL filtering.

## Context

### Relevant Files
- `src/backend/app/services/auth_db.py` - User queries, `last_seen_at`
- `src/backend/app/storage.py` - R2 deletion functions
- `src/backend/scripts/reset_all_accounts.py` - Existing full-wipe script (extend)
- `src/backend/scripts/reset_account.py` - Single account reset

### Related Tasks
- Depends on: T610 (accurate `last_seen_at` tracking)

### Design Notes
- Production accounts should be protected — never auto-delete prod data without explicit configuration
- Paid users should always get an email warning before deletion
- Consider a "data export" option before deletion for paid users

## Acceptance Criteria

- [ ] Cleanup identifies accounts by tier (guest/free/paid × inactive duration)
- [ ] Runs outside main server process (Worker or cron)
- [ ] Production environment has explicit opt-in (not auto-enabled)
- [ ] Paid users receive email warning before deletion
- [ ] Cleanup is idempotent and resumable
