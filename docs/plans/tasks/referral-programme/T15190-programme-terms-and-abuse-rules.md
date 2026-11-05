# T15190: Programme terms and abuse rules

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Tier:** M (a terms page, constants, and enforcement tests on T15150's read model)
**Created:** 2026-11-05
**Updated:** 2026-11-05

Epic: [referral-programme/EPIC.md](EPIC.md). Epic task 5 of 5.

## Problem

A revenue share invites edge cases the read model must already handle and the terms must state:
self-referral, a referrer buying through their own referred accounts, refunds and disputes after
payout, the 60-day window, a minimum payout, and what happens when either account is deleted.

## Solution

- **Terms page** on the landing site (plain language, the glossary's words): share, window,
  payout timing and hold, minimum payout, exclusions, changes to the programme.
- **Enforcement** in T15150's read model, each a named constant and a test: self-referral and
  same-household heuristics are out of scope (no device fingerprinting); the rules are: no accrual
  on the referrer's own purchases; no accrual on refunded or disputed revenue; clawback shown as a
  negative balance; minimum payout `REFERRAL_MIN_PAYOUT_CENTS`; accrual stops at account deletion
  of the referred user only for purchases after it (none can occur).
- **Admin flags**: referrers whose referred users were created from the same IP within an hour
  (`ip_rate_events` already records sign-up IPs) are flagged for review, never auto-blocked.

## Context

### Relevant Files (REQUIRED)
- `src/landing/src/pages/referral-terms.astro` (new)
- `src/backend/app/services/referral_constants.py` (min payout, hold)
- `src/backend/app/services/referral_earnings.py` (rules) + tests
- `src/backend/app/routers/admin.py` (flags in the owed list)

### Related Tasks
- Depends on: T15150
- Blocks: T15170 (the email links the terms)

### Technical Notes
- Flags are informational; a wrong auto-block costs more goodwill than a wrong payout.
- The terms page is content; copy approved by the owner before the first send.

## Implementation

### Steps
1. [ ] Failing tests for each rule
2. [ ] Constants + rules
3. [ ] Terms page draft for owner approval
4. [ ] Admin flags

### Progress Log

**2026-11-05**: Filed.

## Acceptance Criteria

- [ ] Each rule has a test that fails without it
- [ ] Terms page published and linked from the referrer page and the outreach email
- [ ] Flagged referrers appear with the reason in the owed list; nothing is blocked automatically
