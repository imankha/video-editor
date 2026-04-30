# T2370: Positioning & Pricing Sections

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-04-30
**Updated:** 2026-04-30

## Problem

Pay-as-you-go is a competitive advantage against Trace and Veo subscriptions, but pricing isn't visible on the current page. The positioning ("why us, not them") is also missing -- users with Veo/Trace don't understand that Reel Ballers is the *next step*, not a replacement.

## Solution

### Section 6 -- Why It's Different

**Header:**
```
## You already have Veo or Trace. This is what you do with the footage.
```

**Body:**
> Veo and Trace give you full-game video and auto-generated team highlights. They're great at that. But the auto-reel is horizontal, broadcast-styled, and your kid is one of 22 players in the frame. Reel Ballers is the next step -- the part where you actually make a clip about your player.

**Three bullets:**
- **Vertical, with your player followed.** Not center-cropped. Not fixed-zoom. Following.
- **Upscaled, so the zoom doesn't go grainy.** 4x neural upscaling on the cropped region.
- **Pay for what you make.** $2-4 per reel. No subscription.

**Below bullets:** `See pricing ->` (text link, anchors to pricing section)

### Section 7 -- Pricing

**Header:**
```
## Pay for what you make.

No subscription. Credits never expire.
```

**Layout:** Three-column comparison on desktop, stacked on mobile.

| | **Starter** | **Popular** | **Best Value** |
|---|---|---|---|
| Credits | 40 | 85 | 180 |
| Price | $3.99 | $6.99 | $12.99 |
| Per credit | $0.10 | $0.08 | $0.07 |
| Reels (~30s) | ~1 | ~3 | ~6 |
| | [ Buy Starter ] | [ Buy Popular ] | [ Buy Best Value ] |

- Highlight middle pack ("Popular") with raised border + "Most parents pick this" tag
- Each "Buy" button routes to checkout

**Below table:**
```
* Credits never expire
* Failed exports refund automatically
* First export on a new account is free
```

**Below that:** `Or try it free first ->` (full-width text link, routes to upload flow)

## Context

### Relevant Files
- `src/landing/src/App.tsx` -- will add new sections
- Checkout/payment flow routes (external -- just link to them)

### Related Tasks
- Depends on: T2300 (Visual Foundation)

## Implementation

1. [ ] Create WhyDifferent component with header, body paragraph, bullets
2. [ ] Add "See pricing" anchor link
3. [ ] Create Pricing component with 3-column comparison table
4. [ ] Highlight "Popular" pack with visual treatment + "Most parents pick this" tag
5. [ ] Add trust bullets below table (credits never expire, auto-refund, free first export)
6. [ ] Add "Or try it free first" text link below
7. [ ] Responsive: columns stack on mobile
8. [ ] Wire buy buttons to checkout routes

## Acceptance Criteria

- [ ] "Why it's different" section clearly positions as complement to Veo/Trace
- [ ] Three pricing tiers displayed with per-credit breakdown
- [ ] Popular tier visually highlighted
- [ ] Trust bullets visible (never expire, auto-refund, free first)
- [ ] "See pricing" anchor link scrolls to pricing section
- [ ] Responsive: stacked on mobile
