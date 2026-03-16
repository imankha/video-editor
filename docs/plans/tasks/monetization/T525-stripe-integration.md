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
- Depends on: T505 (credit system — grant with source="stripe_purchase")
- Depends on: T520 (pricing — pack sizes and prices)
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

**Credit packs (finalized in T520, placeholder):**
```
small:  10 credits  → $4.99
medium: 50 credits  → $19.99
large:  200 credits → $59.99
```

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
