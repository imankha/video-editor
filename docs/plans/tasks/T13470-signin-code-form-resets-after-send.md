# T13470: Sign-in form reset to the email step after Send Code, and a valid code logged a verify-otp 400 (verify)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** M (frontend auth)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, at 390x844, Playwright, email-code sign-in for imankh+stg-qa-20261025@gmail.com (report bug 2). Not yet reproduced by us.

## Problem

1. Typed the email, tapped Send Code. The email arrived, but when checked about 30 s later the card was back at the empty email step (and the tagline text had changed, as if the sign-in screen remounted). The first code could not be entered, so a second code had to be sent.
2. With the second code, typing the six digits one by one signed the user in, but the console logged `400 /api/auth/verify-otp` "Invalid code. 4 attempts remaining." first. Likely a verify fired on a partial or duplicated value (auto-submit racing a paste or keystroke handler). It burns one of five attempts.

Initial load also showed `401 /api/auth/me` (expected when signed out).

A parent on a phone who switches to their mail app to read the code and comes back would lose the code step the same way.

## Solution

1. Reproduce the remount: what re-renders the sign-in card after Send Code (auth state poll, the `/me` 401 path, a tagline/config load swapping the tree). Keep the code step (and the email) across remounts, for example in the auth store or sessionStorage.
2. Make verify fire exactly once, on a complete 6-digit value.

## Context

### Relevant Files
- Sign-in / OTP component and auth store in `src/frontend/src/` (search `verify-otp`, `[Auth:OTP]`)
- `src/backend/app/routers/auth.py` (`verify-otp`)

## Acceptance Criteria

- [ ] After Send Code the code step stays put while the user leaves and returns to the tab
- [ ] Typing or pasting a correct code makes exactly one verify request, with no 400
- [ ] Test covers both

## Repro steps

1. Signed-out browser at 390x844 (and 768x1024), staging. Enter the test email, tap Send Code.
2. Wait 30-60 s (switch tabs as a parent would to read the email), come back.
3. Type the 6 digits one at a time. Watch Network for `/api/auth/verify-otp`.

**Expected:** the code step is still there; exactly one verify request, status 200.
**Actual (before fix):** step 2: the card had reset to the empty email step once (2026-10-26, part 1). Step 3: two verify requests, 200 then 400 "Invalid code. N attempts remaining" (reproduced again 2026-10-26, part 2, at 768x1024).

## Verify the fix (required, before and after)

1. **Before the fix:** run the repro, record the verify-otp statuses (expect 200 + 400) and whether the step reset; write a component test typing 6 digits that asserts one verify call; see it fail.
2. **After the fix:** same steps: one call, 200; code step survives leaving and returning.

## Progress Log

**2026-10-26**: Part 2 sign-in at 768x1024 reproduced the double verify: statuses [200, 400] for one correct code typed digit by digit.
