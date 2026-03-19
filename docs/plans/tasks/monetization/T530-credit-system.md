# T530: Credit System

**Status:** DONE
**Impact:** 9
**Complexity:** 5
**Created:** 2026-03-17
**Updated:** 2026-03-17

## Problem

GPU operations (Framing export) cost real money (~$3-6 per 60s video on Modal T4). Without a credit system, there's no way to gate usage or monetize. Users need a simple, proportional credit model that reflects actual costs and prevents runaway GPU spend.

## Solution

Implement a per-second credit system: **1 credit = 1 video second of Framing export**. First Framing export and first Annotated Video creation are free ("First Time Is Free"). Overlay export is always free (costs us ~$0.007/60s). Credits are earned through quests (T540) and admin grants (T550), with Stripe purchase planned separately (T525).

### Pricing Rationale

**Cost analysis (Modal T4 GPU):**

| Export Type | Resource | Our Cost (60s video) | Credit Charge |
|-------------|----------|---------------------|---------------|
| **Framing** | T4 GPU (Real-ESRGAN) | ~$3-6 | 1 credit/sec (60 credits) |
| **Overlay** | T4 GPU (25ms/frame) | ~$0.007 | Free |
| **Annotate** | CPU container (FFmpeg) | ~$0.003-0.01 | Free |

**Why per-second for Framing only:**
- Framing is 300-600x more expensive than Overlay/Annotate — it's where virtually all cost is
- Per-second pricing is proportional to value (longer video = more value to user = more cost to us)
- Simple to understand: "1 credit = 1 second of video"
- Prevents gaming (flat per-operation would incentivize long videos)
- Annotate and Overlay are rounding errors cost-wise — making them free removes friction

**Why "First Time Is Free":**
- Lets users experience the full pipeline before needing credits
- Reduces signup-to-value time
- Users who've seen the output are more likely to buy credits

## Context

### Relevant Files

**Backend (new):**
- `src/backend/app/routers/credits.py` - NEW: credit API endpoints
- `src/backend/app/services/auth_db.py` - Add credit columns + queries to central auth DB

**Backend (modify):**
- `src/backend/app/routers/exports.py` - Add credit check before Framing export dispatch
- `src/backend/app/routers/annotate.py` - Track first-time annotate (no credit check, just "first time" flag)
- `src/backend/app/services/export_worker.py` - Deduct credits on job start, refund on failure

**Frontend (new):**
- `src/frontend/src/stores/creditStore.js` - NEW: Zustand store for credit balance
- `src/frontend/src/components/CreditBalance.jsx` - NEW: header balance display
- `src/frontend/src/components/InsufficientCreditsModal.jsx` - NEW: blocking modal

**Frontend (modify):**
- Header/nav component - Add CreditBalance display
- Framing export trigger - Add credit check before API call
- Annotate export trigger - Show "First Time Is Free" on first use

### Related Tasks
- Supersedes: T500 (Credits UI Shell), T505 (Credit System Backend), T510 (GPU Cost Gate), T515 (Free Trial Credits) — those assumed flat per-operation credits
- Depends on: T405 (Central auth DB with auth.sqlite — DONE)
- Blocks: T525 (Stripe Integration — will call grant with source="stripe_purchase")
- Related: T540 (Quest System — grants credits on quest completion)
- Related: T550 (Admin Panel — admin can grant credits manually)

### Technical Notes

**Database Schema (add to auth.sqlite):**
```sql
ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN first_framing_used BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN first_annotate_used BOOLEAN DEFAULT FALSE;

CREATE TABLE credit_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    amount INTEGER NOT NULL,           -- positive = grant, negative = usage
    source TEXT NOT NULL,              -- 'quest_reward', 'admin_grant', 'framing_usage', 'framing_refund', 'stripe_purchase'
    reference_id TEXT,                 -- export job_id, quest_id, stripe_payment_id
    video_seconds REAL,               -- for framing_usage: duration charged
    created_at TEXT DEFAULT (datetime('now'))
);
```

**Credit check flow (Framing export):**
```
Frontend:
  1. User clicks "Export Framing"
  2. Calculate video duration in seconds (from clip data)
  3. Check: is this user's first framing export? (first_framing_used flag)
     → Yes: proceed, show "First Time Is Free" text
     → No: check creditStore.balance >= ceil(duration_seconds)
       → Insufficient: show InsufficientCreditsModal (blocks action)
       → Sufficient: proceed with export

Backend (POST /api/exports/framing):
  1. Check first_framing_used flag
     → First time: set flag to TRUE, proceed without deducting
  2. If not first time: authoritative credit check
     → credits >= ceil(video_seconds) → deduct, create ledger entry, proceed
     → credits < ceil(video_seconds) → return 402 with {required, available, video_seconds}
  3. On GPU job failure → refund credits (source="framing_refund")
```

**Credit check flow (Annotate export):**
```
Frontend:
  1. User clicks "Create Annotated Video"
  2. Check: is this user's first annotate? (first_annotate_used flag)
     → Yes: proceed, show "First Time Is Free" text
     → No: proceed (annotate is always free — no credit check needed)

Backend (POST /api/annotate/export):
  1. If first_annotate_used is FALSE → set to TRUE
  2. No credit deduction (annotate is free)
```

**API Endpoints:**
```
GET  /api/credits              → { balance: 45, first_framing_used: false, first_annotate_used: false }
POST /api/credits/grant        → { amount: 10, source: "quest_reward", reference_id: "quest_1" }
POST /api/credits/deduct       → { amount: 30, source: "framing_usage", reference_id: "job_123", video_seconds: 30.0 }
GET  /api/credits/transactions → [{ id, amount, source, reference_id, video_seconds, created_at }]
```

**InsufficientCreditsModal:**
```
┌─────────────────────────────────────┐
│  Insufficient Credits               │
│                                     │
│  This export requires 45 credits    │
│  (45 seconds of video).             │
│                                     │
│  Your balance: 12 credits.          │
│                                     │
│  [Coming Soon: Purchase Credits]    │
│  [Cancel]                           │
└─────────────────────────────────────┘
```
*(Placeholder — will be replaced by Stripe checkout in T525)*

**"First Time Is Free" UI:**
- When triggering first Framing or first Annotate export, show a banner/badge near the export button: "First Time Is Free"
- After export completes, the banner disappears for that export type

**Credit balance display:**
- Small pill in header: coin icon + number (e.g., "45")
- Only visible when authenticated
- Animates on credit change (grant/deduct)

## Implementation

### Steps
1. [ ] Add credit columns + transactions table to auth.sqlite schema
2. [ ] Implement grant/deduct/balance/first-time functions in auth_db.py
3. [ ] Create credits.py router with GET/POST endpoints
4. [ ] Create creditStore.js Zustand store (fetches from API)
5. [ ] Create CreditBalance.jsx header component
6. [ ] Create InsufficientCreditsModal.jsx
7. [ ] Add credit check to Framing export flow (frontend + backend)
8. [ ] Add first-time-free logic for Framing and Annotate
9. [ ] Add refund logic on GPU job failure
10. [ ] Add "First Time Is Free" UI indicator
11. [ ] Backend tests: grant, deduct, insufficient balance, first-time-free, refund
12. [ ] Frontend tests: credit display, modal trigger, first-time-free flow

## Acceptance Criteria

- [ ] Credit balance visible in header when authenticated
- [ ] Framing export checks credits (1 per video second, rounded up)
- [ ] First Framing export is free with "First Time Is Free" text shown
- [ ] First Annotate export shows "First Time Is Free" text (annotate is always free)
- [ ] Overlay export is always free (no credit check)
- [ ] Insufficient credits shows blocking modal with balance info
- [ ] Credits deducted before GPU job starts
- [ ] Credits refunded on GPU job failure
- [ ] Transaction ledger records all changes with source + reference
- [ ] Credit balance updates in real-time after grant/deduct
