# T12610: Welcome email with tutorial and social links for every new signup

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** M (backend, 1-2 layers, no schema change unless the design gate says otherwise)
**Created:** 2026-10-12
**Updated:** 2026-10-12

## Problem

The all-user re-engagement email ([T7610](T7610-stuck-user-outreach.md)) gives every EXISTING user the tutorial and
social links. Users who sign up after that send would never get them. We want every user, old and new, to
have the same links.

## Solution

When a brand-new account is created, send a short plain-text welcome email from Iman with: the tutorial
link, the social links, the Discord invite, and the same "tell me where you got stuck / reports that help
us fix something earn free credits" ask used in T7610. Ships AFTER the T7610 all-user send, so nobody gets
both on the same day.

## Context

### Relevant Files (REQUIRED)

- `src/backend/app/routers/auth.py` - `_find_or_create_user` returns `(user_id, is_new)`; the login handler (around line 427) is the one place a new account is known to be new
- `src/backend/app/services/email.py` - add `send_welcome_email`, next to `send_otp_email` / `send_admin_update_email`
- `src/backend/tests/` - new test for the welcome email trigger

### Related Tasks

- Depends on: T7610 (shares copy, links, and the credit-for-reports wording); tutorial published; socials ready
- Memory: fire-and-forget background work is deferred until sessions are pinned to one machine (T1537), so the send must not depend on a background task surviving a machine swap

### Technical Notes

- Trigger only when `is_new` is true. Never on a returning login, never on re-signup after deletion unless the user is genuinely new (decide in design; a deleted-then-re-registered user such as bigajosue arguably should get it).
- Exactly-once: a retry or double callback must not send twice. The signup-bonus grant already uses a `signup:{user_id}` ledger key; reuse that existing once-only seam if it fits. Do NOT add new Postgres state (project rule) without a user ruling.
- A mail failure must never fail or delay sign-in: log a warning and move on (external dependency, so a fallback is allowed).
- Links (tutorial, socials, Discord) come from config or constants, not literals scattered in the template. Placeholders in T7610 become the real values here.
- Copy rules: ASCII, no em dashes, "highlight" never "reel", never claim the app frames or tracks automatically, credits for helpful reports stay generic (no amount).
- Not an editor persistence path: this is a backend lifecycle event, so the gesture-persistence rule does not apply.

## Implementation

### Steps

1. [ ] Failing test: a new signup triggers exactly one welcome email; a returning login triggers none; a mail error does not fail sign-in
2. [ ] `send_welcome_email` in `email.py` using the same transport as the other transactional emails
3. [ ] Call it from the new-account branch in `auth.py`, after the account and signup credits are committed
4. [ ] Put the links in one config location; fill with the real tutorial and social URLs
5. [ ] Curated tests (auth signup, email service); explicit lint
6. [ ] Update `.claude/knowledge/backend-services.md` with the new lifecycle email

### Progress Log

**2026-10-12**: Filed from the user's request while drafting the T7610 all-user email. Not started.

## Acceptance Criteria

- [ ] A brand-new account receives one welcome email with the tutorial link, social links and Discord invite
- [ ] A returning login never sends it; a retried signup never sends it twice
- [ ] A send failure does not affect sign-in
- [ ] Deployed only after the T7610 all-user send has gone out
- [ ] Copy matches T7610's rules (no amounts, no automatic-framing claims, no em dashes)
