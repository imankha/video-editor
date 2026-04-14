# T1330: Remove Guest Accounts

**Status:** DONE
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

- `initSession()` in sessionInit.js: only calls `/api/auth/me`. If no session, returns `{userId: null}` — no guest is created.
- Google login handler (auth.py): simplified — always creates new user or finds existing by email. No guest linking.
- Middleware (db_sync.py): all non-auth endpoints require authenticated session (user_id with email).
- `users.email` column: add NOT NULL constraint after migration.

### Store-level auth gating (from T1340 scope-collapse, 2026-04-13)

Once `initSession()` stops creating guests, **every per-user fetch in the
frontend will 401 pre-login** and the UI will visibly break (see screenshots
from T1340 rollback). The staging UI currently works because guest users
have a real `user_id`, so GET endpoints return empty arrays. T1330 must
preserve that empty-state UX without a guest account.

Approach (agreed design — "approach A"):

1. Each per-user store guards its fetch method with an auth check:
   ```js
   if (!useAuthStore.getState().isAuthenticated) {
     set({ items: [], loading: false });
     return;
   }
   ```
   Stores: `projectsStore`, `gamesDataStore`, `profileStore`, `questStore`,
   `settingsStore`, `galleryStore`.
2. Each store subscribes to `authStore.isAuthenticated` and re-fetches when
   it flips true (login).
3. `App.jsx` stops calling the 7 fetches on `initSession().then(...)` —
   the store-level auth subscription drives fetches post-login.
4. `warmAllUserVideos()` is also gated on `isAuthenticated`.
5. `ProjectsScreen.jsx:108-109`, `FramingScreen.jsx:124` on-mount fetches
   become no-ops pre-login (guarded at the store, so call site is unchanged).

Views should render empty-state UI ("No games yet", "No projects yet")
identically for "unauthenticated" and "authenticated but empty" — views
must not show "Failed to load" for the pre-login case.

### Login surface

T1340 removed the standalone `LoginScreen` component. T1330 must decide:
- **(a)** Reuse `AuthGateModal` with an unmissable "Sign In" trigger in the
  top-right header that opens the modal directly (minimum viable). OR
- **(b)** Resurrect a full-screen login route from git history
  (`git show <pre-revert-sha>:src/frontend/src/components/LoginScreen.jsx`).

Recommend (a) for the first cut — `AuthGateModal` already renders Google
button + `OtpAuthForm`. Only difference from LoginScreen is full-screen
branding, which can wait until feedback demands it.

### Related Tasks
- Part of Auth Integrity epic
- Depends on: T1270 (cookie fix)
- T1340 was originally a dependency (login screen) but its scope was
  collapsed — the login surface work now lives here.

## Implementation

### Steps

**Backend**
1. [ ] Remove `init-guest` and `retry-migration` endpoints from auth.py
2. [ ] Remove `create_guest_user()` from auth_db.py
3. [ ] Remove `_migrate_guest_profile()` and `_merge_guest_into_profile()` from auth.py
4. [ ] Simplify Google login: create user with email directly (no guest linking)
5. [ ] Remove `pending_migrations` table from user_db.py schema
6. [ ] Delete `tests/test_guest_migration.py`
7. [ ] Add NOT NULL constraint to `users.email` in auth_db.py

**Frontend — guest removal**
8. [ ] Simplify `initSession()` — no init-guest fallback
9. [ ] Remove `hasGuestActivity`, `markGuestActivity`, `migrationPending`, `retryMigration` from authStore.js
10. [ ] Remove `GuestSaveBanner`, `MigrationRetryBanner` from App.jsx
11. [ ] Remove `setGuestWriteCallback` wiring from App.jsx/sessionInit.js

**Frontend — store-level auth gating (NEW from T1340 scope-collapse)**
12. [ ] Add `isAuthenticated` guard to each per-user store fetch: projectsStore, gamesDataStore, profileStore, questStore, settingsStore, galleryStore
13. [ ] Subscribe each store to authStore — auto-fetch on login
14. [ ] Remove 7-fetch block from App.jsx `initSession().then(...)` — stores self-drive
15. [ ] Gate `warmAllUserVideos()` on `isAuthenticated`
16. [ ] Verify views render empty-state for unauthenticated (not "Failed to load")

**Frontend — login surface**
17. [ ] Replace `requireAuth()` prompt style: remove the wrapper indirection, components directly open `AuthGateModal` on the mutating gesture
18. [ ] Add persistent "Sign In" button to header (top-right) that opens `AuthGateModal`
19. [ ] Remove all `requireAuth()` call sites after 17

## Acceptance Criteria

- [ ] No `init-guest` endpoint exists
- [ ] No guest migration code exists
- [ ] `grep -r "guest" src/` returns no auth-related hits
- [ ] All users in auth.sqlite have non-null email
- [ ] Frontend tests pass
- [ ] Backend import check passes
