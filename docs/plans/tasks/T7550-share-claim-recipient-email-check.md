# T7550: Email-addressed teammate share claimed by a different account

**Status:** WIP
**Priority:** P2 (potential access-control gap; needs verification first)
**Impact:** 6
**Complexity:** 3
**Created:** 2026-08-24
**Updated:** 2026-08-24

## Problem

Prod evidence (2026-08-24): `pending_teammate_shares` id 10 has
`recipient_email = 'gsarah@gmail.com'` but was resolved at 2026-08-24 05:41:53 by
`resolved_profile_id = 51a07ec3`, which belongs to spampoopers@gmail.com (an internal test
signup). Either:
(a) the claim path resolves by token alone and `recipient_email` is decorative, or
(b) an email check exists and was bypassed.

If ANY link-holder can claim a share that was addressed to a specific email, that is an
access-control gap: a forwarded/leaked link hands the game+clips to whoever clicks first.
Caveat recorded honestly: this specific instance may have been the owner testing with a
self-sent link, and token-based claiming may even be intended (links get forwarded inside
families). The task is to DECIDE the intended semantics and make the code + schema say it.

## Solution

1. Read the claim path (`materialization.claim_game_link` for link claims,
   `pending_teammate_shares` resolution for email shares; they may be distinct flows:
   T5730 notes link claims are deliberately not email-keyed) and establish what actually
   gates a claim today.
2. Decide with the user: strict (claim requires logged-in account email == recipient_email,
   with a clear error otherwise) vs open-by-token (any link-holder claims). If open is
   intended: rename/document the column as advisory (`invited_email`), so future readers
   are not misled, and make the sharer-facing UI honest about link semantics.
3. Implement the decided check + tests. If strict: define the mismatch UX (offer "ask the
   sharer to re-send to your email").

## Context

### Relevant Files
- `src/backend/app/services/materialization.py` - claim/materialize flows
- `src/backend/app/routers/` share/claim endpoints (locate the pending_teammate_shares
  resolution write)
- `src/backend/app/services/pg.py` - pending_teammate_shares schema

### Technical Notes
- The claim write path already has T4315-class freshness guards; do not disturb them.
- Whatever the decision, the resolved_by evidence trail (who claimed, when) should be
  queryable; today it is only the profile id.

## Acceptance Criteria

- [ ] Actual gating behavior documented from code, not assumption
- [ ] Semantics decision recorded (user call), schema/UI wording matches it
- [ ] If strict: mismatch rejected with clear UX + test; if open: column renamed/documented
