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
