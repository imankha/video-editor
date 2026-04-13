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
