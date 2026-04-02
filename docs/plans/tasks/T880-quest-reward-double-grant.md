# T880: Quest Reward Double-Grant Race Condition

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-04-02
**Depends On:** T920

## Problem

Quest reward claims have a check-then-act race condition. The idempotency check (`_has_claimed_reward()`) and the credit grant (`grant_credits()`) are not atomic — a user can double-claim by sending two requests in rapid succession.

### Exploit Steps

1. Complete quest (all steps done)
2. Click "Claim Reward" — request A fires
3. Before A responds, click again — request B fires
4. Both pass `_has_claimed_reward()` (neither has committed yet)
5. Both call `grant_credits()` — user gets 2x rewards

### Impact

- Quest 1-4: 15+25+40+45 = 125 credits → 250 credits possible
- Also affects Stripe: webhook + confirm-intent can race (less likely but same pattern)

## Root Cause

`_has_claimed_reward()` (auth.py:220-226) reads `credit_transactions`, but the check and the grant are in separate transactions with no atomicity guarantee.

## Solution

**T920 adds a UNIQUE index** on `credit_transactions(user_id, source, reference_id)` in user.sqlite. This is the atomic guard — the second INSERT fails with IntegrityError.

After T920:

1. **Wrap `grant_credits()` call in try/except IntegrityError** — return `already_claimed: true`
2. **Remove `_has_claimed_reward()` function** — the UNIQUE index IS the idempotency check (faster, atomic)
3. **Frontend: disable claim button** while request is in-flight (defense in depth)
4. **Same fix for Stripe**: `has_processed_payment()` becomes redundant — IntegrityError on duplicate reference_id handles it

## Relevant Files

- `src/backend/app/routers/quests.py` — Lines 253-284: `claim_reward()`, Lines 220-226: `_has_claimed_reward()`
- `src/backend/app/services/user_db.py` (after T920) — `grant_credits()` with UNIQUE constraint
- `src/backend/app/routers/payments.py` — Stripe confirm-intent and webhook paths

## Acceptance Criteria

- [ ] Quest claim handles IntegrityError as already_claimed (not 500)
- [ ] Stripe payment handles IntegrityError as already_processed (not 500)
- [ ] `_has_claimed_reward()` removed (UNIQUE index replaces it)
- [ ] `has_processed_payment()` simplified or removed
- [ ] Frontend disables claim button while request is in-flight
