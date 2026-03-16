# Monetization Epic

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Prepaid credit system to fund GPU operations. Users get free starter credits on signup, purchase more via Stripe when exhausted. Credits gate all GPU operations (annotation video creation, clip export, upscale). Built so Stripe snaps in after auth is working.

## Design Decisions

- **Model:** Prepaid credits (not subscription) — users pay for what they use, no recurring cost anxiety
- **Free tier:** Small starter credits on email verification (exact amount TBD in T520)
- **Payment:** Stripe Checkout (hosted) — zero PCI scope, solopreneur-friendly
- **Refunds:** Auto-refund credits on GPU job failure
- **No subscription:** Credit packs only, simplest billing model
- **Build order:** Credit system first (Stripe-ready interface), Stripe last

## Tasks

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T500 | [Credits UI Shell](T500-credits-ui-shell.md) | TODO | Balance display + insufficient modal (mock data) |
| T505 | [Credit System Backend](T505-credit-system-backend.md) | TODO | Schema, balance/deduct/grant API, ledger |
| T510 | [GPU Cost Gate](T510-gpu-cost-gate.md) | TODO | Check credits before GPU ops, deduct, refund |
| T515 | [Free Trial Credits](T515-free-trial-credits.md) | TODO | Grant on email verify, one-time |
| T520 | [Pricing Exploration](T520-pricing-exploration.md) | TODO | AI-assisted pricing research |
| T525 | [Stripe Integration](T525-stripe-integration.md) | TODO | Checkout, webhooks, credit packages |

## Completion Criteria

- [ ] Credit balance visible in UI
- [ ] GPU operations blocked when credits = 0
- [ ] Free credits granted on first email verification
- [ ] Stripe purchase flow works end-to-end
- [ ] Refunds on failed GPU jobs
- [ ] Pricing validated against costs and value
