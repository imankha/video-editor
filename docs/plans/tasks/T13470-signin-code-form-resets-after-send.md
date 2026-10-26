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
