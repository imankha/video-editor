# T13410: Account Settings says "Signed in with Google" for accounts that signed in with an email code

**Status:** WIP
**Impact:** 4
**Complexity:** 2
**Tier:** S/M (frontend, maybe the /me response)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Outside AI new-user QA run on staging, 2026-10-25/26 (`docs/plans/ux/2026-10-25-staging-new-user-test-prompt.md`). Confirmed in code.

## Problem

An account created and signed in with the email code shows "Signed in with Google" and "Google Account Linked" in Account Settings. The cause is `src/frontend/src/components/AccountSettings.jsx:30`: `const isGoogleLinked = !!email;`, so any signed-in email reads as Google.

## Solution

Show how the account actually signs in. Use a real signal for a linked Google identity (for example whether the user has a `google_id`, exposed on the session/me response) and label email-code accounts as signed in with email.

## Context

### Relevant Files
- `src/frontend/src/components/AccountSettings.jsx`
- `src/backend/app/routers/auth.py` (`/api/auth/me` response)

### Related Tasks
- None

## Acceptance Criteria

- [ ] An email-code account shows it is signed in with email, and no "Google Account Linked"
- [ ] A Google account still shows Google
- [ ] A unit test covers both

## Progress Log

**2026-10-26**: Seen again in staging QA part 2 at 390x844: the same dialog also shows a "Google Account: Linked" row for the email-code account. Cover both labels.
- 2026-10-27 QA pass 2 (staging): VERIFIED at 1440: Account Settings shows 'Signed in with email code'. Escape closes the dialog (T13500 item 1).
