# T11890: Investigate the silent Google sign-in failure before handling it

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** M (investigation first; any fix is filed as a follow-up once the cause is known)
**Created:** 2026-10-04
**Updated:** 2026-10-04 (rescoped by user ruling U2)

## Epic Context

Task 3 of 3 in [Epic E](EPIC.md). Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## User ruling U2 (2026-10-04)

The designer's options (always-visible "Get a sign-in code by email" link, a focus-based "couldn't
open Google" notice, redirect mode) are **all rejected**. Reasons, in the user's words, summarized:

1. It may not be a real problem: the failure could be an artifact of the auditor's test browser on
   staging.
2. A generic "try email instead" path invites a user who signed up with Google to sign in another
   way, land in an empty account, and report lost data.
3. Failure handling must be **specific to the failure**, and we do not yet know why this one happened.

So this task finds the cause first. **Do not add any alternate sign-in prompt, link or notice in this task.**

## Problem

Evidence: [tablet/01](../../../ux/2026-10-04-parent-usability-audit/tablet/01-tablet-login-auth-blocker.png),
[tablet-findings.md](../../../ux/2026-10-04-parent-usability-audit/tablet-findings.md) T-01. At
768x1024, in the auditor's "dedicated in-app browser session" (not Chrome), tapping the personalized
"Continue as Iman" button did nothing: no loading state, no error. The desktop run (also an in-app
browser) signed in fine with the same account.

## What we know from the code (verified 2026-10-04)

- GIS is initialized once with `use_fedcm_for_prompt: true` and no `ux_mode`, so the button uses
  **popup** mode (`src/frontend/src/utils/googleAuth.js:102-117`). The button is rendered by
  `gis.renderButton` in `components/SignInScreen.jsx:32-45` (and `AuthGateModal.jsx:55`).
- If the popup is blocked or cannot open, GIS calls **no callback**, so the app has nothing to react
  to. `emitError` (`googleAuth.js:27-30`) only fires after a credential arrives (missing credential,
  backend reject, network error).
- The button lives in Google's iframe; the app cannot observe the click.
- **Account resolution:** both `POST /api/auth/google` and OTP verify call
  `_find_or_create_user(email, ...)` (`src/backend/app/routers/auth.py:351-380, 427`; OTP at
  `verify_otp`, ~`:690`), which looks the user up **by email**. Same email means same account.
  A *different* email silently creates a new, empty account. That is the data-loss scenario the
  user is worried about, and any future fallback design must account for it.

## Investigation steps

1. **Check the auditor's environment.** It was a non-Chrome "in-app browser session" driven by
   another AI agent. Determine whether that surface allows `window.open` popups and third-party
   cookies/FedCM at all. If it does not, record it as a test-harness artifact.
2. **Reproduce on real surfaces against staging**, with the dev console open, and record for each:
   does the popup open, does `handleCredential` fire, any console errors (GIS logs reasons such as
   `popup_closed`, `popup_failed_to_open`, FedCM errors, `origin_mismatch`):
   - desktop Chrome, normal; desktop Chrome with popups blocked for the site
   - iPad Safari (or Safari at 768x1024), iPhone Safari
   - one real in-app browser (Instagram or Facebook link tap), since share links are opened there
3. **Check staging config.** Confirm `reel-ballers-staging.pages.dev` is an authorized JavaScript
   origin on the Google OAuth client staging uses, and that the client id matches.
4. **Measure whether it happens to real users.** Read-only: in prod and staging logs/analytics,
   compare sign-in screen views (or GIS script loads) with `POST /api/auth/google` attempts and
   successes over the last 30 days, broken down by user agent family if available. A large gap on a
   specific surface means a real problem there; no gap means an artifact.
5. **Add diagnostics only (allowed in this task):** a GIS `intermediate_iframe_close_callback` /
   `native_callback`-style hook, if GIS exposes one for the button, or a FedCM/GIS error listener
   that logs a single analytics count per failure reason. No user-visible change. Skip this step if
   step 4 already answers the question.

## Deliverable

A short findings section appended to this file:
- cause (or "test-harness artifact" with evidence),
- which real surfaces fail, if any, and how often,
- a recommendation for a **failure-specific** fix, filed as a new task only if the failure is real.
  Any fix that offers another way to sign in must first show the user which Google email they used
  before and must not let them create a second account by accident; that design goes to the user.

Status goes to `WAITING ON USER` with the findings link when done.

## Kept from the original proposal (not failure handling)

These two small changes are unrelated to the fallback and may ship in this task if the user agrees
in review; otherwise drop them:
- "Signing you in..." spinner from the moment a Google credential arrives until the app loads
  (only observable interval; no new path).
- A visible `<label>` "Email address" on the existing email field (`components/auth/OtpAuthForm.jsx:211`),
  an accessibility fix. Button text unchanged.

## Landmines

- GIS must be initialized once (`googleAuth.js:7-15`).
- No user-agent sniffing (T7350: UA sniffing broke share twice).
