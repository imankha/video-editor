# T14360: Google sign-in logs red COOP "would block window.postMessage" errors on prod

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-01
**Updated:** 2026-11-01

## Problem

User report 2026-11-01, production console (Chrome), right after the `[Build]` line and
before the first data fetches of the session:

```
client:400 Cross-Origin-Opener-Policy policy would block the window.postMessage call.
kv @ client:400
client:400 Cross-Origin-Opener-Policy policy would block the window.postMessage call.
kv @ client:400
```

`client:400` is Google Identity Services (`https://accounts.google.com/gsi/client`, loaded in
`src/frontend/index.html`). The errors are red, so they read as a failure to anyone opening
the console (us, users sending logs), and they bury real errors. Sign-in itself appears to
have worked (every following request is authenticated and returns 200).

## Context (code read, not yet reproduced)

- Our COOP header is `same-origin-allow-popups`, in `src/frontend/public/_headers` (prod and
  staging, Cloudflare Pages) and `src/frontend/vite.config.js` (dev server). This is the value
  Google documents for the popup flow.
- `src/frontend/src/utils/googleAuth.js` `ensureGisInitialized()` passes
  `use_fedcm_for_prompt: true` (One Tap uses FedCM) but NOT `use_fedcm_for_button`, so the
  rendered button (`SignInScreen.jsx`, `AuthGateModal.jsx`, also used via `ClaimGameView`,
  `SharedAnnotationView`) still uses Google's popup window, which talks back to the opener with
  `postMessage`. Google's own popup page sends a stricter COOP, so Chrome reports the severed
  opener channel even though GIS completes through its fallback.
- `GoogleOneTap.jsx` only prompts when NOT authenticated, so an already signed-in page load
  should not touch GIS beyond loading the script. Most likely trigger: the page load where the
  user just signed in with the button. Unconfirmed: the script load alone may also log it.

## Solution

1. Reproduce first on staging in real Chrome with a clean profile: (a) signed-out load,
   (b) sign in with the button, (c) sign in with One Tap, (d) signed-in reload. Record which
   step logs the error. Do not guess the trigger.
2. Preferred fix if (b) is the trigger: add `use_fedcm_for_button: true` to the single
   `gis.initialize` call in `googleAuth.js` (button uses the browser FedCM dialog, no popup, no
   `postMessage`). Browsers without FedCM keep the popup path; keep the COOP header as is.
3. If the error comes from the script load or One Tap instead, find the GIS option that removes
   it; do not change COOP to `unsafe-none` (that weakens isolation to hide a log line), and do
   not filter `console.error`.
4. Keep the T11890 `auth-diag` diagnostics working (they log `fedcm=` already).

## Acceptance criteria

- In the reproduced steps, no `Cross-Origin-Opener-Policy ... postMessage` error appears in
  the console on staging (Chrome desktop and Android Chrome).
- Button sign-in, One Tap, and sign-in from the auth gate modal still complete and land
  authenticated on Chrome desktop, Android Chrome, and iOS Safari (no FedCM; popup fallback).
- No change to the COOP header value.

## Out of scope

Same log also showed `[SLOW FETCH]` warnings: every boot request about 2.5 s, up to 4.7 s
(`/api/collections/summary`, `POST /api/quests/achievements/returned_home`). Those are yellow
warnings with a separate cause (shared boot-time latency); not part of this task.

## Test scope

Frontend unit test on `ensureGisInitialized` asserting the init options (red before, green
after). Live sign-in check in a real browser per acceptance criteria (pointer/popup behavior
cannot be proven in jsdom).
