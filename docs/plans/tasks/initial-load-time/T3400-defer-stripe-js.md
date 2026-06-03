# T3400: Defer Stripe JS to Payment Flow

**Epic:** [Initial Load Time](EPIC.md)
**Priority:** P2
**Complexity:** 2
**Impact:** 4
**Status:** TODO

## Problem

The Stripe JS SDK loading chain starts at 78ms of page load and cascades through 5 requests (stripe.js, m-outer, inner.html, out.js, telemetry POST) spanning 78-1453ms. While this runs in parallel with auth/me and doesn't add to the critical path on fast connections, it consumes bandwidth and HTTP connections that compete with auth/me on slow connections.

## Evidence

- Stripe SDK loads at 78ms, chain completes at 1453ms
- 5 cascading requests: stripe.js -> m-outer -> inner.html -> out.js -> telemetry POST
- Runs parallel to Phase 1, but competes for bandwidth on mobile/slow connections
- Most users don't interact with payment on every page load

## Implementation

- Remove Stripe `<script>` tag from index.html (or the React-level Stripe provider from the root component tree)
- Lazy-load Stripe SDK when the user first opens the credits/payment modal
- Use `@stripe/stripe-js` `loadStripe()` which supports async loading -- call it in the payment component's mount, not at app level

## Files

| File | Change |
|------|--------|
| `src/frontend/index.html` | Remove Stripe script tag if present |
| `src/frontend/src/App.jsx` (or root provider) | Remove Stripe provider from root tree |
| Payment component (credits modal) | Add lazy `loadStripe()` on mount |

## Acceptance Criteria

- [ ] No Stripe-related network requests on page load (HAR shows zero Stripe calls)
- [ ] Stripe SDK loads when user opens payment/credits modal
- [ ] Payment flow still works correctly after lazy load
- [ ] No visible delay when opening payment modal (Stripe loads in ~200ms)
