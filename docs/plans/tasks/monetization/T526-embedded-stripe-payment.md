# T526: Embedded Stripe Payment Element — Inline Checkout Without Page Redirect

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-03-19
**Updated:** 2026-03-19

## Problem

The current Stripe Checkout flow (T525) redirects users to `checkout.stripe.com`, which loses all UI context. When the user clicks "Frame Video" and can't afford it, they're shown the BuyCreditsModal, select a pack, get redirected to Stripe, pay, and return to the Projects screen — not the Framing screen they were on. This breaks the flow and loses the user's context (project, clip, editor mode).

The ideal UX: user clicks Frame Video → sees insufficient credits + pack selection → enters card inline → pays → credits granted → export starts automatically. Never leaves the page.

## Solution

Replace Stripe Checkout (hosted redirect) with Stripe Payment Element (`@stripe/react-stripe-js`). The payment form renders inline inside the BuyCreditsModal as a second step after pack selection.

### Target UX Flow

1. User clicks "Frame Video" with insufficient credits
2. BuyCreditsModal appears with shortage info + pack selection (existing)
3. User selects a pack → card form appears inline in the same modal (Payment Element)
4. User enters card / taps Apple Pay / Google Pay → pays
5. On success: modal closes, credits granted, toast shown, export starts automatically
6. On failure: error shown inline in the modal, user can retry

User never leaves the page. Project, clip, and editor state are all preserved.

### Technical Approach

**Frontend — Stripe Payment Element:**
- Install `@stripe/stripe-js` and `@stripe/react-stripe-js`
- Use `<Elements>` provider with `<PaymentElement />` for the card form
- Use `<ExpressCheckoutElement />` for Apple Pay / Google Pay
- Theme with Appearance API: `theme: 'night'` + custom variables to match app dark theme
- Two-step modal: pack selection → payment form (same modal, animated transition)

**Backend — Payment Intents:**
- New endpoint: `POST /api/payments/create-intent` → creates PaymentIntent with amount + metadata
- Returns `client_secret` for frontend to confirm payment
- On successful payment confirmation, grant credits (via webhook or direct verification)
- Keep existing webhook endpoint for reliability (Stripe retries on failure)

**After successful payment:**
- Credits granted immediately via direct verification (same pattern as T525 verify endpoint)
- Close modal
- Show toast: "X credits added to your balance!"
- Trigger export automatically (`exportButtonRef.current.triggerExport()`)

## Context

### Relevant Files
- `src/frontend/src/components/BuyCreditsModal.jsx` - MODIFY: add Payment Element step
- `src/frontend/src/components/ExportButtonView.jsx` - MODIFY: wire auto-export after payment
- `src/frontend/src/containers/ExportButtonContainer.jsx` - MODIFY: auto-export callback
- `src/backend/app/routers/payments.py` - MODIFY: add create-intent endpoint
- `src/frontend/package.json` - ADD: @stripe/stripe-js, @stripe/react-stripe-js

### Related Tasks
- Depends on: T525 (Stripe integration — checkout + webhooks + credit packs)
- Supersedes: T525's redirect-based checkout (keeps webhook as fallback)

### Technical Notes

**Stripe Payment Element vs Embedded Checkout:**
- Payment Element chosen over Embedded Checkout because it supports programmatic dark theming (`theme: 'night'` + Appearance API), while Embedded Checkout only supports dashboard branding settings
- Same PCI scope (SAQ A) — card data stays in Stripe's iframe
- Official React SDK: `@stripe/react-stripe-js`

**Appearance API for dark theme:**
```js
const appearance = {
  theme: 'night',
  variables: {
    colorPrimary: '#9333ea', // purple-600
    colorBackground: '#1f2937', // gray-800
    colorText: '#ffffff',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '8px',
  },
};
```

**Apple Pay / Google Pay:**
- Add `<ExpressCheckoutElement />` above `<PaymentElement />`
- Apple Pay requires domain verification in Stripe Dashboard
- Google Pay works automatically in Chrome

## Implementation

### Steps
1. [ ] Install @stripe/stripe-js and @stripe/react-stripe-js
2. [ ] Add POST /api/payments/create-intent backend endpoint
3. [ ] Update BuyCreditsModal: two-step flow (pack selection → payment form)
4. [ ] Add Payment Element with dark theme Appearance API
5. [ ] Add Express Checkout Element for Apple Pay / Google Pay
6. [ ] Handle payment confirmation → grant credits → close modal → trigger export
7. [ ] Keep existing webhook as fallback reliability layer
8. [ ] Remove redirect-based checkout code path (or keep as fallback)
9. [ ] Test: successful payment → credits + auto-export
10. [ ] Test: failed payment → error inline, retry works
11. [ ] Test: Apple Pay / Google Pay on mobile

## Acceptance Criteria

- [ ] Payment form renders inline in BuyCreditsModal (dark themed)
- [ ] User never leaves the page during payment
- [ ] After successful payment, credits are granted and export starts automatically
- [ ] Failed payment shows error inline with retry option
- [ ] Toast shows "X credits added to your balance!" on success
- [ ] Apple Pay / Google Pay available when supported
- [ ] Existing webhook still works as reliability fallback
- [ ] Project, clip, and editor state are fully preserved throughout
