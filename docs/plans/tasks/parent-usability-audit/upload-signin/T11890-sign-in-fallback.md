# T11890: Sign-in fallback when Google cannot open

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M (frontend only, ~4 files + new tests, ~150 LOC). Needs real-browser verification.
**Created:** 2026-10-04
**Decision gate:** U2 (recommended J-2)

## Epic Context

Task 3 of 3 in [Epic E](EPIC.md). Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [tablet/01](../../../ux/2026-10-04-parent-usability-audit/tablet/01-tablet-login-auth-blocker.png).
The tester tapped "Continue as Iman" in an in-app browser and nothing happened: no loading state, no
error, no alternative. The whole journey stopped at sign-in.

Mechanism: GIS runs in popup mode (`utils/googleAuth.js:102-117`). If the popup is blocked, GIS
fires **no callback**. The Google button is Google's own iframe, so **the app cannot see the click**.
"Signing you in..." is therefore only possible after Google returns a credential, during
`POST /api/auth/google`. Google also refuses sign-in inside many embedded webviews, so the email code
is the only universal fallback.

## Solution (J-2)

1. **Always-visible fallback** directly under the Google button, `text-sm text-gray-400`:
   **Google not opening?** followed by a link-style button **Get a sign-in code by email** that
   scrolls to and focuses the email field.
2. **"Signing you in..."** with a spinner, replacing the button area, from the moment
   `handleCredential` receives a credential until `onAuthSuccess` (or an error).
3. **Failure notice heuristic:** when the GIS iframe takes focus (window `blur` while
   `document.activeElement` is the GIS iframe), start a 2s check. If `document.hasFocus()` is still
   true (no popup took focus) and no credential arrived, show an inline amber notice above the email
   form: **We couldn't open Google sign-in here. Try again, or get a sign-in code by email.** and
   focus the email field. **No user-agent sniffing** (T7350: UA sniffing broke share twice).
4. **Email form** (`components/auth/OtpAuthForm.jsx:203-233`): add a persistent `<label htmlFor>`
   **Email address** (`text-sm text-gray-300`); keep the placeholder; button **Email me a code**.
5. **Headline:** keep "Share Your Player's Brilliance" (`SignInScreen.jsx:57`) and add the subline
   **Turn game video into highlights of your player.** (Not the audit's "highlight reel", which
   breaks the vocabulary rule.)

## Relevant Files (under `src/frontend/src/`)

- `utils/googleAuth.js:7-15 (single-init invariant), 27-30 (emitError), 45-117`
- `components/SignInScreen.jsx:32-45, 57, 75-80, 132-158`
- `components/AuthGateModal.jsx:55` (same renderButton pattern; give it the same fallback link)
- `components/auth/OtpAuthForm.jsx:203-233`
- `config/displayNames.js` (new `SIGN_IN` group)

## Implementation Steps

1. Add the strings. Add the fallback link under both Google buttons (SignInScreen, AuthGateModal).
2. Expose a pending listener from `googleAuth.js` (like `onAuthError`) that fires when a credential
   arrives and when the exchange ends; render "Signing you in..." from it.
3. Implement the focus heuristic in a small hook `useGisPopupFailureNotice` with a cleanup on unmount.
4. Label the email field and rename the button.

## Acceptance Criteria

1. With popups blocked in desktop Chrome, tapping the Google button shows the amber notice within
   about 3s and focuses the email field.
2. On a normal sign-in, "Signing you in..." shows between Google returning and the app loading.
3. The fallback link is visible without any failure, and focuses the email field.
4. The email field has a visible label; the button says "Email me a code".

## Tests (red first; none exist today)

- New `SignInScreen.test.jsx`: fallback link present and focuses the email input; pending state shows
  on credential; notice shows when blur + focus check conditions are met (mock `window.google.accounts.id`;
  do not re-initialize GIS).
- New `OtpAuthForm.test.jsx`: label association and button text.
- **Real-browser check (required, record results in the PR):** Chrome with popups blocked, iOS
  Safari, and one Instagram or Facebook in-app browser. If the heuristic misfires in any of them,
  ship J-1 (link + pending state + label) and drop the notice.

## Landmines

- GIS must be initialized once (`googleAuth.js:7-15`); tests must not call `initialize` again.
- Do not switch to `ux_mode: 'redirect'` (J-3): it needs a new backend endpoint with CSRF handling and
  still fails in in-app browsers.
