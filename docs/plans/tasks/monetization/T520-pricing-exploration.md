# T520: Pricing Exploration

**Status:** TODO
**Impact:** 6
**Complexity:** 1
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

Need to determine optimal credit pricing, free tier amount, and credit pack sizes. Must balance: covering GPU costs, perceived value to users, and conversion from free to paid.

## Solution

AI-assisted research session to analyze GPU costs, competitor pricing, willingness-to-pay for sports video editing, and optimal pack sizes. Output: finalized pricing table used by T525 (Stripe Integration).

## Context

### Related Tasks
- Informs: T515 (free credit amount)
- Informs: T525 (Stripe credit packages)
- Informs: T510 (per-operation costs)

### Research Topics

1. **Our GPU costs per operation:**
   - Modal T4 GPU: ~$0.00016/sec
   - Annotation video (avg duration, processing time)
   - Clip export (avg duration, processing time)
   - Upscale (avg duration, processing time)
   - What's our actual cost per operation?

2. **Pricing psychology:**
   - Credit packs vs per-operation pricing
   - Anchor pricing (3 tiers, middle is target)
   - Round numbers vs precise pricing
   - "Credits" vs "dollars" — abstraction effect

3. **Competitor analysis:**
   - Sports video editing tools pricing
   - AI video tool pricing (Runway, Kapwing, etc.)
   - Per-minute vs per-operation models

4. **Free tier optimization:**
   - How many free credits maximize conversion to paid?
   - Too few = users can't experience value
   - Too many = no reason to pay

5. **Output: Pricing table**
   - Cost per operation (in credits)
   - Free tier credits
   - Credit pack sizes + prices
   - Target gross margin

## Acceptance Criteria

- [ ] Documented cost per GPU operation
- [ ] Finalized credit-to-operation mapping
- [ ] Free tier amount decided
- [ ] 3 credit pack tiers with prices
- [ ] Target margin calculated
- [ ] Decisions documented in this file
