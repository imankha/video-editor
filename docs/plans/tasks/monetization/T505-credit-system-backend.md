# T505: Credit System Backend

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

Need a real credit balance and transaction ledger that persists across sessions. Must be built with a clean interface so Stripe can snap in later without restructuring.

## Solution

Add credits and credit_transactions tables to Cloudflare D1 (same DB as auth). Expose API endpoints for balance, grant, and deduct. Deduct/grant functions accept a `source` parameter — currently only "free_grant" and "gpu_usage", later "stripe_purchase" snaps in.

## Context

### Relevant Files
- `src/backend/app/services/auth_db.py` - Add credit tables + queries to D1 service
- `src/backend/app/routers/credits.py` - NEW: credit API endpoints
- `src/frontend/src/stores/creditStore.js` - From T500: replace mock with real API calls

### Related Tasks
- Depends on: T405 (D1 database exists)
- Depends on: T500 (frontend shell exists to wire up)
- Blocks: T510 (GPU cost gate needs real deduct)
- Blocks: T525 (Stripe integration calls grant with source="stripe_purchase")

### Technical Notes

**D1 Schema (add to existing auth DB):**
```sql
ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN free_credits_granted BOOLEAN DEFAULT FALSE;

CREATE TABLE credit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    amount INTEGER NOT NULL,           -- positive = grant, negative = usage
    source TEXT NOT NULL,              -- 'free_grant', 'gpu_usage', 'gpu_refund', 'stripe_purchase'
    reference_id TEXT,                 -- job_id for gpu_usage, stripe_payment_id for purchases
    created_at TEXT DEFAULT (datetime('now'))
);
```

**API Endpoints:**
```
GET  /api/credits          → { balance: 3 }
POST /api/credits/grant    → { amount: 3, source: "free_grant" }  (internal only)
POST /api/credits/deduct   → { amount: 1, source: "gpu_usage", reference_id: "job_123" }
```

**Stripe-ready interface:**
- grant(user_id, amount, source, reference_id) — source="stripe_purchase" + stripe payment ID
- No Stripe-specific code in this task — just the interface that accepts any source

## Implementation

### Steps
1. [ ] Add credit columns + transactions table to D1 schema
2. [ ] Implement grant/deduct/balance functions in auth_db.py
3. [ ] Create credits.py router with GET /api/credits
4. [ ] Wire frontend creditStore to real API (replace mock)
5. [ ] Backend tests: grant, deduct, insufficient balance, ledger entries
6. [ ] Integration test: frontend shows real balance from API

## Acceptance Criteria

- [ ] GET /api/credits returns real balance
- [ ] Grant adds credits + creates ledger entry
- [ ] Deduct subtracts credits + creates ledger entry
- [ ] Deduct with insufficient balance returns 402
- [ ] Transaction ledger records all changes with source + reference
- [ ] Frontend displays real balance from API
- [ ] No Stripe-specific code (clean interface for later)
