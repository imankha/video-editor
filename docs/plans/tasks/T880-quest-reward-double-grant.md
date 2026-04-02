# T880: Quest Reward Double-Grant Race Condition

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-04-02

## Problem

Quest reward claims have a check-then-act race condition. The idempotency check (`_has_claimed_reward()`) and the credit grant (`grant_credits()`) are **not atomic** — they run in separate transactions across separate DB connections (per-user DB for step check, auth.sqlite for credits).

A user can double-claim a quest reward by sending two requests in rapid succession (spam-clicking the "Claim Reward" button, or from multiple tabs). Both requests pass the idempotency check before either commits the grant.

### Exploit Steps

1. Complete quest (all steps done)
2. Click "Claim Reward" — request A fires
3. Before A responds, click again — request B fires
4. Both pass `_has_claimed_reward()` (neither has committed yet)
5. Both call `grant_credits()` — user gets 2x rewards

### Impact

- Quest 1: 15 credits → 30 credits
- Quest 2: 25 credits → 50 credits
- Quest 3: 40 credits → 80 credits
- Quest 4: 45 credits → 90 credits
- Total possible: 250 free credits instead of 125

## Root Cause

`_has_claimed_reward()` (auth.py:220-226) reads `credit_transactions` in one connection. `grant_credits()` (auth_db.py:466-484) writes in a different connection. SQLite WAL allows the read to succeed before the write is committed.

```python
# These are NOT atomic together:
if _has_claimed_reward(user_id, quest_id):  # SELECT from auth.sqlite
    return {"already_claimed": True}
grant_credits(user_id, amount, "quest_reward", quest_id)  # INSERT into auth.sqlite
```

## Solution

Add a UNIQUE constraint on `(user_id, source, reference_id)` in `credit_transactions`. The second INSERT will fail with a constraint violation, which is the correct atomic guard.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_idempotent
ON credit_transactions(user_id, source, reference_id)
WHERE reference_id IS NOT NULL;
```

Wrap the grant in a try/except for `IntegrityError` and return `already_claimed: true`.

### Frontend

Also add a loading state to the "Claim Reward" button to prevent spam-clicks (defense in depth, not sufficient alone).

## Relevant Files

- `src/backend/app/routers/quests.py` — Lines 253-284: `claim_reward()`, Lines 220-226: `_has_claimed_reward()`
- `src/backend/app/services/auth_db.py` — Lines 466-484: `grant_credits()`, Lines 131-145: `credit_transactions` schema

## Also Affects

- **Stripe payments**: Same race possible between confirm-intent and webhook. The UNIQUE index fixes both.
- `deduct_credits()` uses negative amounts with `reference_id=job_id` — unique index prevents double-deduction too.

## Acceptance Criteria

- [ ] UNIQUE index on `credit_transactions(user_id, source, reference_id)` where reference_id is not null
- [ ] Quest claim handles IntegrityError gracefully (returns already_claimed)
- [ ] Stripe confirm-intent handles IntegrityError gracefully
- [ ] Frontend disables claim button while request is in-flight
