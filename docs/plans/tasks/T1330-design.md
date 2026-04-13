# T1330 Design: Remove Guest Accounts

**Branch:** `feature/T1330-remove-guest-accounts`
**Status:** AWAITING APPROVAL

## Goal

Every `user_id` in `auth.sqlite` has a non-null `email`. No anonymous
sessions. Unauthenticated visitors see the full app shell (empty Games /
Projects state), can browse, but every mutating action prompts login.

## Current State

```
Visitor loads app
  → sessionInit → /api/auth/me
    → 401 → /api/auth/init-guest → creates anon user_id + cookie
  → all fetches succeed (empty arrays)
  → writes run under guest user_id
  → requireAuth() opens modal for "important" writes only
  → hasGuestActivity tracked → GuestSaveBanner nags on exit
  → on login: _merge_guest_into_profile() copies guest's games/achievements
    into authenticated user's DB; pending_migrations table tracks failures;
    MigrationRetryBanner retries.
```

Failure modes this creates:
- Cookie loss → new guest ID → orphaned data under old ID
- Deploy wipe → same
- Partial migration → data split across 2 user_ids, email attached to one

## Target State

```
Visitor loads app
  → sessionInit → /api/auth/me → 401 → { userId: null, isAuthenticated: false }
  → app renders; per-user stores skip fetch (empty state)
  → visitor clicks any mutating gesture → AuthGateModal opens
  → signs in (Google or OTP) → user_id created with email
  → stores auto-fetch on isAuthenticated flip → app populates
```

No guest user_ids. No migration. No `pending_migrations` table.

## Plan

### 1. Schema migration (auth.sqlite)

`users.email` currently nullable (guests have NULL). Target: NOT NULL.

**Problem:** existing guest rows break the constraint.

**Approach:**
- Startup migration in `auth_db.py.init_auth_db()`: `DELETE FROM users WHERE email IS NULL;` then `ALTER TABLE users ...` to rebuild with NOT NULL.
- SQLite can't add NOT NULL via ALTER — use the table-rebuild pattern (create `users_new` with constraints, copy rows, drop old, rename).
- Cascade: `sessions.user_id` → ON DELETE CASCADE already in schema; guest sessions cleaned up automatically.
- Drop `pending_migrations` table entirely.

**Risk:** destructive. User's prod auth DB has some guest rows. Deletion is correct (they're orphaned per the epic's premise), but we must:
- Snapshot auth.sqlite before the migration runs in prod (add `.backup` file).
- Log row counts before/after.
- Gate on a `MIGRATION_REMOVE_GUESTS` env var for the first prod run, so we can stage it.

### 2. Backend removals

- `auth.py`: delete `init_guest`, `retry_migration`, `_migrate_guest_profile`, `_merge_guest_into_profile`. Simplify `google_auth` (no guest linking — just find-or-create by email). Simplify `otp_verify` the same way.
- `auth_db.py`: delete `create_guest_user`.
- `user_db.py`: remove `pending_migrations` table from schema.
- `middleware/db_sync.py`: non-auth endpoints now require a session with `email` (not just `user_id`). Return 401 instead of silently allowing.
- Delete `tests/test_guest_migration.py`, `tests/test_migration_recovery.py`.

### 3. Frontend — remove guest plumbing

- `sessionInit.js`: on `/me` 401 → `setSessionState(false)` and return `{userId: null}`. Delete init-guest branch, delete `setGuestWriteCallback`.
- `authStore.js`: drop `hasGuestActivity`, `markGuestActivity`, `migrationPending`, `retryMigration`, `setMigrationPending`, `setGuestWriteCallback` wiring. Keep `requireAuth` (still the gate; condition is now "not authenticated").
- `App.jsx`: delete `GuestSaveBanner`, `MigrationRetryBanner`, `hasGuestActivity` selector, `setGuestWriteCallback` call. Delete the 7 initial fetches from the `initSession().then(...)` block — stores self-drive after login.
- Delete components: `GuestSaveBanner.jsx`, `MigrationRetryBanner.jsx`.

### 4. Frontend — store-level auth gating (approach A)

Each per-user store gains:

```js
// on fetch entry
if (!useAuthStore.getState().isAuthenticated) {
  set({ items: [], loading: false });
  return;
}
```

And subscribes to authStore to auto-fetch on login:

```js
// module-level, runs once per store
useAuthStore.subscribe((s, prev) => {
  if (s.isAuthenticated && !prev.isAuthenticated) {
    store.getState().fetchXxx();
  }
});
```

Stores: `projectsStore`, `gamesDataStore`, `profileStore`, `questStore`, `settingsStore`, `galleryStore`.
Also gate `warmAllUserVideos()` on `isAuthenticated` (hook callers check or `cacheWarming.js` early-returns).

Views must render empty-state ("No games yet") identically for `unauthenticated` and `authenticated-but-empty`. Current `ProjectsScreen` shows "Failed to load / Cannot connect to server" when fetch fails — that error UI is wrong pre-login. Store guard makes fetch resolve with empty data, so the error path doesn't trigger.

### 5. Login surface

Per task file: use `AuthGateModal` + a persistent header "Sign In" button. Minimum viable.

- Add `<SignInButton />` to header (top-right), visible when `!isAuthenticated`. Onclick: `useAuthStore.getState().openAuthModal()` (new action).
- Already authenticated users see `<AccountSettings>` (existing behavior).
- `AuthGateModal` unchanged — same Google + OTP UX, already uses centralized GIS callback.

### 6. requireAuth call sites

Keep `requireAuth` — it's still "run this action only if authed, else prompt". Post-T1330 it always prompts the modal on miss (no guest-fallthrough), which matches current behavior. All existing call sites keep working as-is.

The only call sites touched are `GuestSaveBanner` and `MigrationRetryBanner` references, which are deleted.

## Test Strategy

**Backend (TDD):**
- `test_auth_no_guest.py`:
  - `GET /api/auth/me` with no cookie → 401 (exists, keeps).
  - `POST /api/auth/init-guest` → 404 (endpoint removed).
  - `POST /api/auth/google` creating new user: row has email, no guest link.
  - Middleware: `POST /api/games/...` without auth → 401 (not silently allowed).
- `test_auth_db_schema.py`:
  - Run `init_auth_db()` on a DB containing guest rows → guests deleted, NOT NULL constraint active, attempting to insert NULL email raises.

**Frontend (TDD):**
- `authStore.test.js`: fetching per-user data pre-login is a no-op.
- `projectsStore.test.js` / `gamesDataStore.test.js`: store subscribes to authStore, fetches only after `isAuthenticated → true`.
- E2E (smoke): fresh visit → no data fetches fire → sign in → data loads.

## Risks

1. **Schema migration in prod.** Gate with env var; require manual run on first deploy. Don't auto-run without an R2 backup confirmation.
2. **Unknown call sites.** Any code path using `getUserId()` pre-login will now see null. Grep needed before merge.
3. **Sync / R2 uploads.** Guest-era writes sometimes queued R2 uploads. With no guest, writes can't happen pre-login; sync paths triggered by session init must no-op when `!isAuthenticated`.
4. **Local dev R2 disabled.** `init_auth_db()` still runs; ensure the NOT NULL migration works on an in-memory dev DB without existing rows.
5. **Existing user cookies** pointing at guest user_ids will 401 post-deploy (their row deleted). They get bounced to empty shell → login. Same-device recovery via `onAuthSuccess` still works because it looks up by email.

## Open Questions

1. **Prod migration rollout.** One-shot ALTER on next deploy, or a 2-step (ship rip-out code with guest rows left in place, then a follow-up migration task)? Recommend one-shot with explicit `ENABLE_GUEST_CLEANUP=true` env var the user flips for the prod deploy.
2. **Header "Sign In" button styling.** Matching account settings button style (existing in the header) or distinct? Recommend matching.
3. **OTP flow — do we keep `/api/auth/retry-migration`?** Removed per task spec. Confirming.

## Files

**Backend:**
- `src/backend/app/routers/auth.py` (~200 LOC removed)
- `src/backend/app/services/auth_db.py` (~30 LOC removed, ~40 LOC migration added)
- `src/backend/app/services/user_db.py` (~10 LOC removed)
- `src/backend/app/middleware/db_sync.py` (~5 LOC changed)
- `src/backend/tests/test_guest_migration.py` (deleted)
- `src/backend/tests/test_migration_recovery.py` (deleted)
- `src/backend/tests/test_auth_no_guest.py` (new)
- `src/backend/tests/test_auth_db_schema.py` (new)

**Frontend:**
- `src/frontend/src/stores/authStore.js`
- `src/frontend/src/stores/projectsStore.js`
- `src/frontend/src/stores/gamesDataStore.js`
- `src/frontend/src/stores/profileStore.js`
- `src/frontend/src/stores/questStore.js`
- `src/frontend/src/stores/settingsStore.js`
- `src/frontend/src/stores/galleryStore.js`
- `src/frontend/src/utils/sessionInit.js`
- `src/frontend/src/utils/cacheWarming.js`
- `src/frontend/src/App.jsx`
- `src/frontend/src/components/SignInButton.jsx` (new)
- `src/frontend/src/components/GuestSaveBanner.jsx` (deleted)
- `src/frontend/src/components/MigrationRetryBanner.jsx` (deleted)
