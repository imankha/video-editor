# T1340: Auth-First Login Screen

**Status:** TESTING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-04-10
**Scope collapsed:** 2026-04-13

## Scope Change (2026-04-13)

The original task proposed a full-screen LoginScreen that gated the entire
app behind authentication. During implementation the user clarified the real
requirement:

> "I don't think we need to change the UI flow to accommodate no guest users,
> we just need to make sure there are no user actions that change persisted
> state before login."

With that framing, a login-gate is the wrong shape. The visual flow already
matches staging/prod (empty Games/Projects state before sign-in), and write
protection is already enforced by `requireAuth` → `AuthGateModal` on guest
sessions. Gating render would also force a store-level rework of every
per-user fetch — that work belongs to T1330, where the guest path is
actually removed.

T1340's remaining scope is the collection of subsidiary improvements that
came out of the investigation:

1. Extract shared OTP flow into `components/auth/OtpAuthForm.jsx` (was
   inlined in `AuthGateModal`). Gives T1330 a reusable login surface.
2. Fix Google One Tap regression caused by duplicate component mounts and
   StrictMode cleanup races (commit `bb1ce07`).
3. FedCM migration: drop deprecated `isNotDisplayed()` / `isSkippedMoment()`
   callbacks, opt into `use_fedcm_for_prompt: true`.

The full LoginScreen component was implemented, reviewed, and then removed
(reverted in the scope-collapse commit). Its logic lives in git history and
can be resurrected by T1330 if a standalone sign-in page is desired there.

## Implementation (as shipped)

### Changed

- `src/frontend/src/components/AuthGateModal.jsx` — OTP form extracted into
  `OtpAuthForm`; modal now a thin wrapper.
- `src/frontend/src/components/auth/OtpAuthForm.jsx` — new, shared.
- `src/frontend/src/components/GoogleOneTap.jsx` — removed cleanup
  `gis.cancel()` (StrictMode race), added `use_fedcm_for_prompt: true`,
  removed deprecated status callbacks.
- `src/frontend/src/main.jsx` — `<GoogleOneTap />` and `<AuthGateModal />`
  now mount once at the root (were duplicated inside `App.jsx`).
- `src/frontend/src/App.jsx` — removed duplicate `<GoogleOneTap />` and
  `<AuthGateModal />` mounts.

### Reverted

- `src/frontend/src/components/AppAuthGate.jsx` — removed.
- `src/frontend/src/components/LoginScreen.jsx` — removed.
- `src/frontend/src/__tests__/AppAuthGate.test.jsx` — removed.
- `src/frontend/src/__tests__/LoginScreen.test.jsx` — removed.
- `src/frontend/src/utils/sessionInit.js` — `/api/auth/init-guest` fallback
  restored (T1330 removes it for real).

## Acceptance Criteria

- [x] OTP flow extracted into a reusable component
- [x] Google One Tap works on the branch (parity with staging)
- [x] No `GSI_LOGGER` FedCM deprecation warnings in console
- [x] No duplicate auth component mounts
- [x] StrictMode-safe mount (no `gis.cancel()` race)
- [x] Visual flow unchanged from staging/prod (empty states pre-login)
- [x] Mutating actions still gated by `requireAuth` → `AuthGateModal`

## Follow-on

T1330 owns the real "no guest accounts" cutover. That task must:

- Remove `/api/auth/init-guest` (backend) and the frontend fallback.
- Refactor the 7 per-user stores to no-op (or return empty state) when no
  authenticated user exists — approach A from the 2026-04-13 design
  discussion (see ORCHESTRATOR-NOTES.md).
- Decide on the login surface: reuse `AuthGateModal` with an unmissable
  trigger, or reintroduce a `LoginScreen` route.

## Manual Verification

1. **Fresh visit / no cookie:** clear cookies, reload. Games/Projects empty
   state renders (matches staging screenshot). No console errors.
2. **Add Game while unauthenticated:** click Add Game → `AuthGateModal`
   opens with Google button + OTP form. Sign in → game save proceeds.
3. **Returning user:** sign in, reload. Editor renders directly, no flash.
4. **Google One Tap:** hover the top-right "Sign in" chip → account chooser
   appears. No FedCM deprecation warnings in console.
