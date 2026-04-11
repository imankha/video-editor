# T1330: Remove Guest Accounts

**Status:** TODO
**Impact:** 10
**Complexity:** 6
**Created:** 2026-04-10

## Problem

The guest account system creates orphaned data when sessions are lost. A single user can end up with multiple user_ids, losing their email and data. The migration logic (guest → authenticated) adds complexity and has its own failure modes.

## Solution

Remove the entire guest account system. No user_id is created until Google sign-in succeeds.

## Context

### What Gets Removed

**Backend (src/backend/):**
- `POST /api/auth/init-guest` endpoint (auth.py ~lines 623-678)
- `POST /api/auth/retry-migration` endpoint (auth.py ~lines 681-732)
- `_migrate_guest_profile()` function (auth.py ~lines 283-435)
- `_merge_guest_into_profile()` function (auth.py ~lines 198-280)
- `create_guest_user()` in auth_db.py (~lines 448-461)
- `pending_migrations` table from user_db.py schema (~lines 74-82)
- Guest migration logic in Google login handler (auth.py ~lines 512-530)
- Guest migration logic in OTP handler

**Frontend (src/frontend/src/):**
- `init-guest` call path in `utils/sessionInit.js` (~lines 210-235)
- `hasGuestActivity` state + `markGuestActivity()` in `stores/authStore.js`
- `requireAuth()` wrapper in `stores/authStore.js` (~lines 43-52)
- `GuestSaveBanner` component in `App.jsx` (~lines 671-687)
- `MigrationRetryBanner` in `App.jsx` (~lines 485, 503)
- `migrationPending` state + `retryMigration()` in `stores/authStore.js`
- `setGuestWriteCallback()` in `utils/sessionInit.js`
- All `requireAuth()` call sites: `ProjectManager.jsx`, `ExportButtonContainer.jsx`, `ProfileDropdown.jsx`, `CompareModelsButton.jsx`

**Tests:**
- `tests/test_guest_migration.py` — entire file

### What Changes

- `initSession()` in sessionInit.js: only calls `/api/auth/me`. If no session, returns unauthenticated (frontend shows login screen).
- Google login handler (auth.py): simplified — always creates new user or finds existing by email. No guest linking.
- Middleware (db_sync.py): all non-auth endpoints require authenticated session (user_id with email).
- `users.email` column: add NOT NULL constraint after migration.

### Related Tasks
- Part of Auth Integrity epic
- Depends on: T1270 (cookie fix), T1340 (login screen must exist before removing guest path)

## Implementation

### Steps
1. [ ] Remove `init-guest` and `retry-migration` endpoints from auth.py
2. [ ] Remove `create_guest_user()` from auth_db.py
3. [ ] Remove `_migrate_guest_profile()` and `_merge_guest_into_profile()` from auth.py
4. [ ] Simplify Google login: create user with email directly (no guest linking)
5. [ ] Remove `pending_migrations` table from user_db.py schema
6. [ ] Remove `requireAuth()`, `hasGuestActivity`, `markGuestActivity`, `migrationPending`, `retryMigration` from authStore.js
7. [ ] Remove `GuestSaveBanner`, `MigrationRetryBanner` from App.jsx
8. [ ] Simplify `initSession()` — no init-guest fallback
9. [ ] Remove all `requireAuth()` call sites in components
10. [ ] Delete `tests/test_guest_migration.py`
11. [ ] Add NOT NULL constraint to `users.email` in auth_db.py

## Acceptance Criteria

- [ ] No `init-guest` endpoint exists
- [ ] No guest migration code exists
- [ ] `grep -r "guest" src/` returns no auth-related hits
- [ ] All users in auth.sqlite have non-null email
- [ ] Frontend tests pass
- [ ] Backend import check passes
