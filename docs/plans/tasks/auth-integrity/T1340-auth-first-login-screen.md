# T1340: Auth-First Login Screen

**Status:** TODO
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

- [ ] First visit shows login screen, not editor
- [ ] Google sign-in works and loads app
- [ ] Returning users with valid cookie go straight to app (no login flash)
- [ ] OTP sign-in works from login screen
- [ ] Mobile-friendly layout
- [ ] FedCM migration: opt in via `use_fedcm_for_prompt: true` and stop relying on `isNotDisplayed()` / `isSkippedMoment()` status methods (GSI_LOGGER deprecation warning currently printed on every load from `GoogleOneTap.jsx:68`). Migration guide: https://developers.google.com/identity/gsi/web/guides/fedcm-migration
- [ ] No `GSI_LOGGER` FedCM deprecation warnings in console on initial load
- [ ] Handle `cancel_called` / FedCM `AbortError` cleanly when the prompt is dismissed or the component unmounts (no unhandled rejection in console)
- [ ] **De-duplicate auth component mounts.** `<GoogleOneTap />` and `<AuthGateModal />` are each mounted TWICE in `App.jsx` (lines 475/632 and 477/634 respectively — one for guest branch, one for authed branch). Each pair races: one instance's cleanup calls `gis.cancel()` which aborts the other's `gis.prompt()`, producing `cancel_called` + `FedCM AbortError` in console. Fix: hoist these to a single top-level mount outside the branch. The "google.accounts.id.initialize() is called multiple times" GSI warning comes from the same duplication.
- [ ] **StrictMode-safe mount.** `GoogleOneTap.jsx` useEffect cleanup calls `gis.cancel()` which, under React 18 StrictMode double-invoke in dev, cancels the prompt between mount/remount. Guard with a module-level ref or skip cleanup cancel on first unmount (pattern already used in `DetectionMarkerLayer.jsx` and `AnnotateScreen.jsx:340`). Without this, the dev experience of One Tap is effectively broken even when prod works.
- [ ] **Investigate same-device auth state sticking.** After T1270 landed (SameSite=Lax + path=/), `rb_session` persists more reliably across navigations. If a stale/test session cookie exists, `isAuthenticated=true` and `GoogleOneTap.jsx:51` suppresses the prompt entirely. The new LoginScreen must either (a) surface a clear "Not you? Sign out" affordance when `isAuthenticated` is true but user hits the login path, or (b) ensure sign-out fully clears the cookie (`delete_cookie` with `path="/"` — T1270 added `path="/"` to set_cookie but check delete_cookie call sites too).
