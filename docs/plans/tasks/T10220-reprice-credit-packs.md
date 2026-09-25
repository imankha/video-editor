# T10220: Rebalance monetization: 12.99 / 22.99 / 32.99 ladder

**Status:** WIP (started 2026-09-24 via /dotask; user's /dotask call taken as the go-ahead past the Deploy Candidate deferral. Merge held: a master push of pricing.json auto-deploys the prod landing)
**Impact:** 7
**Complexity:** 2
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User direction 2026-09-17 (Deploy Candidate): "rebalance monetization. Make 12.99 lowest option.
22.99 middle option and 32.99 max option. Retain discount curve for bigger orders. Change on main
site and in app."

Today's ladder (T4940): Starter 80 credits / $3.99 (4.99c per credit), Popular 160 / $6.99
(4.37c), Best Value 340 / $12.99 (3.82c).

## Solution

After T10210 this is a one-file edit to `src/backend/app/pricing.json` plus the decision on
credits per tier. Everything else (Stripe amounts, `/api/payments/config`, the app's buy modal,
`CREDIT_VALUE` on both sides, the landing pricing cards, lowest-rate stat and worked example, the
invariant tests) derives.

**RULED 2026-09-17: reading B** ("we need to continue to incentivize users to buy bigger credit
packs"), and the whole task is deferred until after the Deploy Candidate ships. The two readings,
kept for the record:

| Reading | Starter 12.99 | Middle 22.99 | Max 32.99 | Storage anchor `CREDIT_VALUE` |
|---|---|---|---|---|
| A. Keep today's per-credit RATES (4.99c / 4.37c / 3.82c): a bigger pack, same value per dollar | 260 credits | 526 credits | 864 credits | stays 0.05 (worst case 4.99c) |
| B. Keep today's 12.99 = 340 credits mapping and extend the curve downward (+14% / +33% bonus steps) | 340 credits | 690 credits | 1,120 credits | drops to 0.04 (worst case 3.82c), so upload/extension storage costs ~25% MORE credits |

Reading B (chosen) changes the storage-cost formula on both sides (derived, by design): the
anchor moves from 5c to 4c, so upload/extension charges cost ~25% more credits while every credit
costs the user less. State that consequence in the deploy notes and in the T4940 doc. Round the
credit counts to tens (340 / 690 / 1,120 already are).

Either way: T4940's power-law check (`unit_price(q) = p0 x (q/q0)^-k`, k in 0.15-0.25) should
still hold across the three rungs, and the ladder invariant tests enforce "bigger is cheaper per
credit".

## Context

### Relevant Files
- `src/backend/app/pricing.json` (the only pricing edit)
- `src/backend/app/pricing.py` docstring example (`399c/80`) - update the worked number
- `src/frontend/src/components/BuyCreditsModal.jsx` `PACK_META` - presentational labels/badges
  keyed by pack key; keep keys `starter` / `popular` / `best_value` unless the user wants new names
- `docs/plans/tasks/monetization-pass/T4940-...md` - append the decision + rationale
- `docs/plans/revenue-projection-2000-users.md` - projection assumes the old ladder; note it
- `.claude/skills/deploy/SKILL.md:144` mentions "Starter, $3.99" as a smoke-test example
- `src/frontend/e2e/t4940-monetization-qa.spec.js` is structural (3 packs, ascending) and survives

### Related Tasks
- Depends on: T10210 (single-source pricing) - merged first, then this is trivial
- Deploy note: Stripe prices are inline `price_data` / `amount` (no Price IDs), so no dashboard
  work; in-flight sessions and historical grants read metadata off the Stripe object, not the
  constant, and are unaffected.

## Implementation

### Steps
1. [x] Reading B chosen by the user 2026-09-17 (tier names unchanged unless the user says otherwise)
2. [ ] Edit `pricing.json`; run `test_t4940_pack_pricing.py` + `pricing.test.js` (invariants)
3. [ ] `npm run build` in `src/landing` and eyeball the pricing section + worked example
4. [ ] Update the T4940 doc + revenue projection note; deploy landing via `/deploy-landing`
   when the app deploys (both must flip together)

## Acceptance Criteria

- [ ] App buy modal and landing pricing section show 12.99 / 22.99 / 32.99 with strictly
      decreasing per-credit price
- [ ] Storage-cost preview in the app equals the backend charge (derived `CREDIT_VALUE`)
- [ ] One real test purchase on staging (Stripe test mode) grants the new credit count
- [ ] Tests pass with no literal edits

## Results (implementation, 2026-09-24)

New ladder (derived from `pricing.json`, verified via `app.pricing`):

| Pack | Credits | Price | Per-credit rate | Pairwise k |
|---|---|---|---|---|
| Starter | 340 | $12.99 | 3.8206c | - |
| Popular | 690 | $22.99 | 3.3319c | 0.193 (340->690) |
| Best Value | 1,120 | $32.99 | 2.9455c | 0.254 (690->1120) |

- Overall power-law fit (first rung to last): **k = 0.218**, inside the 0.15-0.25 band. The last
  pairwise step is 0.254 (marginally above), but the exact credit counts are the user's ruling-B
  choice and the ladder invariant (strictly decreasing per-credit rate) holds; there is no
  automated k test, only the design guideline.
- **Storage anchor:** `CREDIT_VALUE` moved `0.05 -> 0.04` (worst-case rate is now Starter's
  3.8206c ceil'd to 4c, was 4.9875c ceil'd to 5c). Frontend and backend both derive it, so the
  in-app upload/extension preview equals the backend charge.
- **Representative storage before/after** (same formula, only the anchor changed):
  - 6 GB upload, 30 days: **3 -> 4 credits** (storage 2->3, +1 auto-export surcharge).
  - 6 GB extension, 30 days: **2 -> 3 credits**.
  - 2.5 GB upload, 30 days: **2 -> 3 credits**.
  - Net effect ~25% more credits per byte-month stored (0.05/0.04), rounded up by the `max(1, ceil)`.
- Analytics: retired T4940 sizes 80/160 added to `_RETIRED_CREDIT_AMOUNT_TO_CENTS` (399/699) so
  historical purchase rows keep a price; 340 stays live at 1299c.

## Deploy note

- **Landing auto-deploys on a master push that touches `pricing.json`** (it imports the app's
  pricing module via the `@editor` alias and rebuilds). The merge to master MUST therefore be
  coordinated with the prod app deploy so the marketing site and the in-app buy modal flip to the
  new ladder together - do not merge this ahead of the app deploy or the site will advertise
  12.99/22.99/32.99 while the running app still charges the old ladder (or vice versa).
- **Storage-cost consequence for users:** because `CREDIT_VALUE` drops to $0.04, every upload and
  storage extension costs ~25% more credits from the moment this ships. Existing balances and
  in-flight/historical Stripe payments are unaffected (grants read pack metadata off the Stripe
  object, not this file), but new uploads are charged at the new anchor immediately.
- In-flight revenue (corrected 2026-09-24, T10220 proof verification): before T8620, revenue was
  booked at `CREDIT_PACKS[pack]["price_cents"]` when the webhook arrived, so an old-price checkout
  completing after the deploy would have been booked at the new price. T8620 (merged first) records
  the amount Stripe actually captured in the `payments` ledger and bumps `total_spent_cents` by that
  same amount, so revenue is correct across the switchover too.
- Stripe prices and products are created inline on each purchase (`price_data`/`product_data` in
  Checkout, `amount` on the PaymentIntent, all from `pricing.json`); there are no Stripe Price or
  Product IDs. **No Stripe dashboard work** is required for the new ladder (user asked 2026-09-24).
- Merged 2026-09-24 on the user's instruction ahead of the prod app deploy: the landing site goes
  live with the new ladder on merge; the app follows at the next `/deploy`.
