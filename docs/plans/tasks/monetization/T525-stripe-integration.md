# T525: Stripe Integration

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

Users who exhaust free credits need to purchase more. Stripe Checkout (hosted) provides a payment flow with zero PCI scope — ideal for a solopreneur.

## Solution

Stripe Checkout sessions for credit purchases. User clicks "Buy Credits" → redirect to Stripe hosted page → webhook confirms payment → credits granted. Three credit pack tiers (prices from T520).

## Context

### Relevant Files
- `src/backend/app/routers/payments.py` - NEW: Stripe Checkout + webhook endpoints
- `src/frontend/src/components/InsufficientCreditsModal.jsx` - From T500: replace placeholder with real purchase flow
- `src/frontend/src/components/BuyCreditsModal.jsx` - NEW: pack selection UI

### Related Tasks
- Depends on: T530 (credit system — grant with source="stripe_purchase")
- Depends on: Auth epic complete (need user identity for Stripe customer)

### Technical Notes

**Stripe Checkout (hosted):**
- Zero PCI scope — Stripe handles entire payment page
- Backend creates Checkout Session → returns URL → frontend redirects
- Stripe sends `checkout.session.completed` webhook → backend grants credits
- Stripe customer linked to user_id in D1

**Endpoints:**
```
POST /api/payments/checkout  → { pack: "medium" } → { checkout_url: "https://checkout.stripe.com/..." }
POST /api/payments/webhook   → Stripe webhook → grant credits
```

**Credit packs (from T530 cost analysis):**

1 credit = 1 second of Framing export. Our GPU cost = ~$0.0033/credit.

| Pack | Credits | Price | Per Credit | Per Minute | Discount | GPU Cost | Stripe Fee | Net Profit | Margin |
|------|---------|-------|-----------|------------|----------|----------|------------|------------|--------|
| **Starter** | 120 | $4.99 | $0.042 | $2.50 | — | $0.40 | $0.44 | $4.15 | 83% |
| **Popular** | 400 | $12.99 | $0.032 | $1.95 | 22% off | $1.32 | $0.68 | $10.99 | 85% |
| **Pro** | 1,000 | $24.99 | $0.025 | $1.50 | 40% off | $3.30 | $1.02 | $20.67 | 83% |

**Pricing rationale (growth phase):**
- Starter ($4.99): Below impulse-buy threshold for sports parents. Buys one 2-min highlight. "Cheaper than a latte."
- Popular ($12.99): Covers a tournament weekend (3-4 clips). "Most Popular" badge. Under "ask spouse" threshold.
- Pro ($24.99): Full season of highlights. "Best Value" badge. Less than one private coaching lesson.
- Never expire credits — brings parents back next season without re-acquisition cost.

**Price anchoring:** Professional highlight reels cost $200-500. Recruiting services charge $800-4,000.
ReelBallers: $4.99-$24.99 for the same output (40-100x cheaper).

**Growth-phase notes:**
- $4.99 floor avoids Stripe fixed-fee erosion ($0.30 eats 18% at $1.99 vs 9% at $4.99)
- All packs profitable enough to fund ads + server costs
- Prioritize conversion volume over per-user revenue at this stage
- Can introduce $9.99/mo subscription later once repeat purchase data exists

**Webhook security:**
- Verify Stripe signature using webhook secret
- Idempotency: check if payment already processed (reference_id = stripe payment ID)

## Implementation

### Steps
1. [ ] User creates Stripe account + webhook (manual setup step)
2. [ ] Add stripe Python package to backend
3. [ ] Create payments.py router with checkout + webhook endpoints
4. [ ] Create BuyCreditsModal.jsx with pack selection
5. [ ] Wire InsufficientCreditsModal "Buy Credits" to BuyCreditsModal
6. [ ] Test with Stripe test keys: purchase → webhook → credits granted
7. [ ] Test idempotency: duplicate webhook doesn't double-grant
8. [ ] Add Stripe env vars to staging deployment

## Acceptance Criteria

- [ ] "Buy Credits" shows pack selection
- [ ] Selecting a pack redirects to Stripe Checkout
- [ ] Successful payment triggers webhook
- [ ] Webhook grants correct credits
- [ ] Duplicate webhooks don't double-grant
- [ ] Credit balance updates after returning from Stripe
- [ ] Works with Stripe test keys on staging
