# Orchestrator Carry-Forward Notes

Running ledger of surprises, shared context, and hand-off notes between
subagents working the Auth Integrity epic. Each task appends a section.

## T1270 — Cookie Path + SameSite

- Branch: `feature/T1270-cookie-path-fix` (NOT merged; awaiting user approval
  and manual Google OAuth / OTP verification).
- `src/backend/app/routers/auth.py` has 4 `set_cookie("rb_session", ...)` calls
  (google_auth ~l.561, init_guest ~l.670, OTP verify ~l.924, test-login
  ~l.979) plus 1 `delete_cookie` in logout (~l.945). All now include
  `path="/"`. If T1290/T1340/T1330 add new cookie call sites, they MUST
  include `path="/"` and `samesite=_SAMESITE` — the AST test in
  `tests/test_auth_cookie_config.py` will catch omissions on all 5+ sites.
- `_SAMESITE` is now an unconditional string literal `"lax"`. Do not change
  it back to a ternary — the AST test resolves `samesite=_SAMESITE` by
  following module-level string-literal assignments and will fail
  (resolve to `None`) if it becomes a conditional expression again.
- `_SECURE_COOKIES` is still environment-driven (`SECURE_COOKIES=true` in
  staging/prod). Leave it alone.
- Test pattern: AST inspection of `auth.py` was chosen over TestClient
  because driving Google OAuth and OTP verify through TestClient requires
  mocking `google.oauth2.id_token.verify_oauth2_token` and the OTP state
  machine. AST inspection gives equivalent coverage in one file with no
  mocks. Future auth tests should follow this pattern for cookie attributes.
- Backend suite has 15 pre-existing failures unrelated to this epic: most
  notable are `test_sync_retry` (`ImportError: retry_pending_sync` — symbol
  no longer exists in `app/middleware/db_sync.py`), `test_annotations_aggregates`
  (6 errors — `/api/games/{id}` returning 404 in the TestClient fixture),
  and `test_admin::test_admin_can_grant_credits` (balance 150 vs expected 50,
  likely test pollution). **T1290 works in `app/main.py` startup and
  `app/services/auth_db.py` — it will not touch these failing suites, but
  be aware they are already red on master.**
- T1290 should assume `test_guest_migration.py` and
  `test_migration_recovery.py` still exist and some are red on master; T1330
  will delete them. Do not fix them under T1290 — scope creep.
- `conftest.py` autouse fixture sets `set_current_profile_id("testdefault")`
  and pre-seeds `_init_cache` for user IDs `"a"` and `"testdefault"`. Any
  new backend auth test that mutates profile context should reset it in
  teardown — otherwise later tests in the same session inherit the change.
- Commits on the branch:
  - `55e1ef1` — failing test
  - `612f037` — fix
  - (docs commit to follow)
- Do not push. Do not merge to master. Orchestrator will do both after
  user approval.

## T1290 — Auth DB Restore

- Branch: `feature/T1290-auth-db-restore-must-succeed` (NOT merged; awaiting
  user approval and manual staging verification of the fatal-fail path).
- Startup touch point is `app/main.py` ~lines 270–274 (now 270–275, a single
  `restore_auth_db_or_fail()` call). The old `if _r2: sync_auth_db_from_r2(); init_auth_db()`
  pattern is gone — T1340 should import the new helper instead if it needs to
  re-trigger auth DB setup (it shouldn't, but heads up).
- `sync_auth_db_from_r2` behaviour CHANGED: it now **raises** on transient /
  non-404 errors instead of swallowing into `return False`. Any other code
  path that calls this function (currently only startup) must treat a raised
  exception as a real failure. Grep: only one call site today, in
  `restore_auth_db_or_fail` itself.
- New `_r2_enabled()` shim in `auth_db.py` wraps `storage.R2_ENABLED` — exists
  purely as a patch target for tests. Don't inline it away.
- Retry wrapper at startup is hand-rolled (not `retry_r2_call`) because the
  retry util retries *transient* errors only — at startup level we want to
  retry any failure from `sync_auth_db_from_r2` including RuntimeErrors, so
  a dedicated 3-attempt loop with exponential backoff (1s → 2s → 4s) lives
  inside `restore_auth_db_or_fail`. `sync_auth_db_from_r2` still uses
  `retry_r2_call` internally for the network-level retries, so the worst case
  is 3 × 4 = 12 download attempts before fatal — acceptable on boot.
- Log conventions: all new lines use the `[AuthDB]` prefix (matches existing
  style). Warnings for attempts 1–2 of 3 retries, error for the final
  attempt, then a `RuntimeError` raise. No `print()`. T1340 should mirror
  the `[AuthX]` bracketed-component prefix when adding startup-time logs.
- Test pattern: `tests/test_auth_db_restore.py` patches `auth_db._r2_enabled`,
  `auth_db.sync_auth_db_from_r2`, and `auth_db.init_auth_db` directly. This
  is the cleanest way to exercise startup retry logic without hitting R2.
  T1340/T1330 auth tests should follow the same "patch the module-level
  seam, not the storage globals" pattern where possible.
- Backend suite remains at 15 FAILED + 6 ERRORS, matching the T1270 baseline
  exactly. Zero new failures from T1290. The earlier estimate of "15
  pre-existing failures" was approximate; the actual count on master is
  15 failures + 6 errors (same as now). If T1340/T1330 see the same number
  they are clean.
- Commits on the branch:
  - `d4ce555` — failing tests
  - `38c3b2e` — fix
  - (docs commit to follow)
- Fly auto-restart behaviour is assumed (standard Fly machine policy on
  non-zero exit) — not re-verified under this task. Manual verification
  steps live in the task file under "Manual Verification".

## T1340 — Auth-First Login Screen

- Branch: `feature/T1340-auth-first-login-screen` (NOT merged; AWAITING USER
  VERIFICATION — Google OAuth round-trip and OTP email delivery are not
  unit-testable).
- New render gate: `src/frontend/src/components/AppAuthGate.jsx` wraps `<App />`
  in `main.jsx`. Three branches: `isCheckingSession` → spinner,
  `!isAuthenticated` → `<LoginScreen />`, authed → children. The existing
  `isCheckingSession` short-circuit in App.jsx (line 446 `if (isCheckingSession) return null;`)
  is now dead code — App.jsx only renders once AppAuthGate has already confirmed
  authenticated. Left it in place (defensive / cheap); T1330 can remove if desired.
- OTP logic EXTRACTED into `src/frontend/src/components/auth/OtpAuthForm.jsx`.
  Consumed by both `LoginScreen.jsx` and `AuthGateModal.jsx`. `resetKey` prop
  forces an internal reset (AuthGateModal passes `showAuthModal`).
- `sessionInit.js` no longer calls `/api/auth/init-guest` on `/me` 401. The
  frontend guest code path is effectively dead but NOT removed — per T1330's
  scope. What's still live in frontend:
  - `authStore`: `hasGuestActivity`, `markGuestActivity`, `migrationPending`,
    `retryMigration`, `setMigrationPending` — unused by the happy path now.
  - `App.jsx`: `<GuestSaveBanner>`, `<MigrationRetryBanner>` — rendered
    conditionally on `hasGuestActivity && !isAuthenticated` and
    `migrationPending`. Both conditions are now unreachable under T1340's
    gate but the JSX is intact.
  - `sessionInit`: `setGuestWriteCallback` + axios response interceptor that
    calls `_onGuestWrite` still exist. Harmless but unused.
  - Backend `/api/auth/init-guest`, `/api/auth/retry-migration`, and
    `_migrate_guest_profile` are all untouched. T1330 removes them.
- `GoogleOneTap.jsx` still mounts in main.jsx. When LoginScreen is visible it
  both try to initialize GIS; LoginScreen's `useEffect` runs and overwrites
  the GIS callback (GIS supports only one). LoginScreen owns the viewport
  so OneTap's floating prompt is moot — but worth knowing if T1330 sees
  double-init logs.
- `onAuthSuccess` in authStore calls `window.location.reload()` on cross-device
  recovery and redirects via `setSessionState` otherwise. Unchanged by T1340.
- Unit tests added at `src/frontend/src/__tests__/` (new `__tests__` dir):
  - `AppAuthGate.test.jsx` — 3 cases
  - `LoginScreen.test.jsx` — 1 smoke test
  Pattern: mock authStore with `vi.mock('../stores/authStore', ...)`. Follow
  this for any new auth-layer tests in T1330.
- Frontend unit suite: 27 files / 439 tests passing. Build: exit 0.
- Commits on the branch:
  - `c729751` — failing tests
  - `3f847a1` — implementation
  - (docs commit to follow)

## T1340 — Scope collapse (2026-04-13)

The full-screen LoginScreen + AppAuthGate were reverted after user feedback:

> "I don't think we need to change the UI flow to accommodate no guest users,
>  we just need to make sure there are no user actions that change persisted
>  state before login."

Key learnings for T1330:

- **Don't gate render on auth.** The app's empty-state UX already works
  correctly for "guest with user_id but no email". Gating render forces
  every per-user fetch to be re-pathed; gating writes (which is the actual
  requirement) is already handled by `requireAuth` → `AuthGateModal`.
- **Stores do per-user fetches from many places, not just App.jsx.**
  `ProjectsScreen.jsx:108-109`, `FramingScreen.jsx:124`, `profileStore.js:226-227`,
  and `gamesDataStore.js:298` all fire fetches outside App.jsx's orchestration.
  Any "don't fetch before login" strategy MUST live at the store level or
  every call site has to be updated individually. Approach A (store-level
  guard + subscribe to authStore) is the design T1330 should follow.
- **Views must render empty-state identically for "unauthenticated" and
  "authenticated but empty".** Current `ProjectsScreen` shows "Failed to
  load games / Cannot connect to server" when fetches 401 — that error UI
  is wrong for the pre-login case. T1330 must either (a) make stores
  resolve with empty data pre-login, or (b) have views suppress error UI
  when `!isAuthenticated`.
- **One Tap / FedCM fixes are permanent wins** and stayed on the branch:
  - Dedupe mounts — `<GoogleOneTap />` / `<AuthGateModal />` live in
    `main.jsx`, not `App.jsx`.
  - No cleanup `gis.cancel()` (StrictMode race).
  - `use_fedcm_for_prompt: true`; no deprecated `isNotDisplayed`/`isSkippedMoment`.
- **OtpAuthForm is reusable** — `src/frontend/src/components/auth/OtpAuthForm.jsx`.
  T1330's login surface (modal or standalone page) should consume it.
- **Deleted from the branch during revert** (resurrect from git if needed):
  - `src/frontend/src/components/AppAuthGate.jsx`
  - `src/frontend/src/components/LoginScreen.jsx`
  - `src/frontend/src/__tests__/AppAuthGate.test.jsx`
  - `src/frontend/src/__tests__/LoginScreen.test.jsx`
- `sessionInit.js` `/api/auth/init-guest` fallback is back in place. T1330
  removes it for real and must ship store-level auth gating in the same
  change — otherwise the unauthenticated shell will 401-storm on load.
