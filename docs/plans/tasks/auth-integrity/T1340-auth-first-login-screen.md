# T1340: Auth-First Login Screen

**Status:** AWAITING USER VERIFICATION
**Impact:** 9
**Complexity:** 4
**Created:** 2026-04-10

## Problem

Without guest accounts, the app needs a login screen on first visit. Currently the app loads directly into the editor with a guest session.

## Solution

Show a full-screen login page when no authenticated session exists. Google sign-in and OTP email are both first-class options.

## Context

### Relevant Files
- `src/frontend/src/App.jsx` — top-level routing, currently renders editor immediately
- `src/frontend/src/components/GoogleOneTap.jsx` — currently a floating nudge for guests
- `src/frontend/src/stores/authStore.js` — `isAuthenticated` state
- `src/frontend/src/utils/sessionInit.js` — session initialization

### Related Tasks
- Part of Auth Integrity epic
- Must be implemented BEFORE T1330 (remove guest accounts) — login screen needs to exist before the guest path is removed
- Blocks: T1330

## Implementation

### Steps
1. [ ] Create `LoginScreen` component with branding, Google sign-in button, and OTP email input
2. [ ] In App.jsx, gate the entire app behind `isAuthenticated`
3. [ ] `initSession()` calls `/api/auth/me` — if 401, show LoginScreen (no guest fallback)
4. [ ] On successful Google sign-in, `onAuthSuccess()` sets `isAuthenticated=true`, app renders
5. [ ] Adapt `GoogleOneTap` for prominent placement on login screen (not floating nudge)
6. [ ] OTP flow: email input → send code → verify code → authenticated
6. [ ] Loading state while checking `/api/auth/me` (spinner, not flash of login screen)

## Acceptance Criteria

- [x] First visit shows login screen, not editor (AppAuthGate + LoginScreen; unit-tested)
- [ ] Google sign-in works and loads app (manual verification — requires Google OAuth round-trip)
- [x] Returning users with valid cookie go straight to app (no login flash) (AppAuthGate renders spinner while `isCheckingSession`, skipping LoginScreen; unit-tested)
- [ ] OTP sign-in works from login screen (manual verification — requires real email delivery)
- [x] Mobile-friendly layout (fluid container `max-w-sm sm:max-w-md`, `px-4 py-8 overflow-auto`, 320px Google button — verified against responsiveness skill targets 360–428px; visual manual check still pending)
- [x] FedCM migration: opted in via `use_fedcm_for_prompt: true` and dropped `isNotDisplayed()` / `isSkippedMoment()` status callbacks (fixed in commit `bb1ce07`).
- [x] No `GSI_LOGGER` FedCM deprecation warnings in console on initial load (fixed in `bb1ce07`).
- [x] `cancel_called` / `FedCM AbortError` no longer occur — root causes were duplicate mounts + StrictMode cleanup race, both fixed in `bb1ce07`.
- [x] De-duplicated auth component mounts — `<GoogleOneTap />` and `<AuthGateModal />` now mount once in `main.jsx` instead of twice in `App.jsx` (fixed in `bb1ce07`).
- [x] StrictMode-safe mount — removed the cleanup `gis.cancel()` that was racing with React 18 StrictMode double-invoke (fixed in `bb1ce07`).
## Manual Verification

Run these after pulling the branch and `npm run dev`:

1. **First visit / no cookie:** clear cookies for the app origin, reload. LoginScreen appears (branding + Google button + OTP email input). Editor does NOT mount.
2. **Returning user (valid cookie):** sign in once (Google or OTP). Reload the page. You should see the brief spinner (auth-gate-loading), then the editor — NO login-screen flash.
3. **Google sign-in round-trip:** from the LoginScreen, click the Google button → pick an account → land in the editor. Check console: `[Auth:Login] Success: ...` and no `GSI_LOGGER` / FedCM deprecation warnings.
4. **OTP round-trip:** from the LoginScreen, enter an email → Send Code → receive email → enter 6-digit code → auto-verifies and lands in the editor.
5. **Mobile viewport (375 px):** devtools → 375×667. LoginScreen layout is usable: card does not clip horizontally, Google button fits, OTP input row fits, copy wraps cleanly.
6. **Logout:** from inside the app, Account → Logout. Reload. LoginScreen reappears. (`delete_cookie` has `path="/"` from T1270 — cookie clears correctly.)

## T1340 Implementation Notes

- New component tree: `main.jsx` renders `<AppAuthGate><App /></AppAuthGate>` + sibling `<GoogleOneTap />` + `<AuthGateModal />`. AppAuthGate chooses between loading spinner, LoginScreen, and children based on `isCheckingSession` / `isAuthenticated`.
- OTP logic extracted from AuthGateModal into `components/auth/OtpAuthForm.jsx` — both LoginScreen and AuthGateModal now consume it. `resetKey` prop lets AuthGateModal reset internal state on open/close.
- `sessionInit.js` no longer calls `/api/auth/init-guest` on `/me` 401. It sets `setSessionState(false)` and returns `{userId: null, profileId: null}`; AppAuthGate then renders LoginScreen. The `/api/auth/init-guest` endpoint itself is untouched (T1330 removes it).
- Tests added: `src/__tests__/AppAuthGate.test.jsx` (3 cases: checking / unauth / authed) and `src/__tests__/LoginScreen.test.jsx` (smoke).
- Same-device auth stickiness: with T1270's cookie fix, returning users hit the spinner → editor path automatically. The existing AccountSettings → Logout affordance combined with `delete_cookie(..., path="/")` (auth.py:950) is the sign-out path; no extra "Not you?" affordance added — the user is already inside the editor if they're authed, and can logout from there. If future feedback shows users need it on the login screen, we can surface a sign-out link there too.

### (Original investigation note)
- [x] **Investigate same-device auth state sticking.** After T1270 landed (SameSite=Lax + path=/), `rb_session` persists more reliably across navigations. If a stale/test session cookie exists, `isAuthenticated=true` and `GoogleOneTap.jsx:51` suppresses the prompt entirely. The new LoginScreen must either (a) surface a clear "Not you? Sign out" affordance when `isAuthenticated` is true but user hits the login path, or (b) ensure sign-out fully clears the cookie (`delete_cookie` with `path="/"` — T1270 added `path="/"` to set_cookie but check delete_cookie call sites too).
