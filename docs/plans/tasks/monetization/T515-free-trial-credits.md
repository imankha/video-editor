# T515: Free Trial Credits

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

Users need to experience GPU features before paying. A small free credit grant on email verification lets them create their first video without payment friction.

## Solution

On successful email verification (or Google OAuth), grant N free credits (exact amount TBD in T520). One-time only — tracked by `free_credits_granted` flag on user record.

## Context

### Relevant Files
- `src/backend/app/routers/auth.py` - Trigger credit grant after successful verify
- `src/backend/app/services/auth_db.py` - free_credits_granted flag check + set
- `src/backend/app/routers/credits.py` - grant function

### Related Tasks
- Depends on: T400/T401 (auth flow — triggers the grant)
- Depends on: T505 (credit system backend — grant function)
- Related: T520 (pricing exploration determines the free credit amount)

### Technical Notes

**Grant logic (in verify-otp and google-auth handlers):**
```python
if not user.free_credits_granted:
    grant_credits(user_id, FREE_CREDIT_AMOUNT, source="free_grant")
    set_free_credits_granted(user_id)
```

**FREE_CREDIT_AMOUNT:** Start with 3 (enough for 3 annotation videos). Finalize in T520.

**One-time enforcement:** The `free_credits_granted` boolean prevents re-grants if user logs in again, creates new sessions, etc.

**UX after grant:**
- Auth modal success screen could say "You've got 3 free credits!"
- Credit balance in header immediately shows new balance

## Implementation

### Steps
1. [ ] Add free credit grant call to verify-otp handler
2. [ ] Add free credit grant call to google-auth handler
3. [ ] Check free_credits_granted flag before granting
4. [ ] Update auth modal success screen to show credit grant message
5. [ ] Test: first verify → credits granted
6. [ ] Test: second verify (return visit) → no duplicate grant

## Acceptance Criteria

- [ ] First email verification grants free credits
- [ ] First Google auth grants free credits
- [ ] Subsequent logins do NOT re-grant
- [ ] User sees credit grant confirmation in UI
- [ ] Credit balance immediately reflects grant
