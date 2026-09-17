# T10210: Pricing set in one place, reflected everywhere

**Status:** WIP
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User direction 2026-09-17, ahead of the Deploy Candidate reprice (T10220): "refactor code so we
only need to set pricing in 1 place and it's reflected everywhere. keep it dry."

Before this task the credit-pack ladder was written down four times and several derived numbers
were hand-copied:

| Copy | Where |
|------|-------|
| `CREDIT_PACKS` dict | `src/backend/app/routers/payments.py` (billing truth) |
| `CREDIT_PACKS` array | `src/landing/src/site.ts` ("mirrored by hand") |
| `CREDIT_VALUE = 0.05` | `src/backend/app/services/storage_credits.py` (storage-cost anchor) |
| `CREDIT_VALUE = 0.05` | `src/frontend/src/utils/storageCost.js` ("keep in sync") |
| `3.8` cents lowest rate, `$1.83` worked example, `3 credits` storage example | `src/landing/src/pages/index.astro`, literal |
| exact prices/credits | `test_t4940_pack_pricing.py`, `BuyCreditsModal.test.jsx`, `test_storage_extension.py`, `StorageExtensionModal.test.jsx` |

A reprice therefore meant editing about eight files and would still drift the landing site.

## Solution

One data file, two thin derivation modules, everything else derives:

- **`src/backend/app/pricing.json`** is THE source. Bare pack rows (`key`, `name`, `credits`,
  `price_cents`) in ladder order. It lives in the backend tree because the Fly Docker build
  context is `src/backend` only; the two JS builds run from a full checkout so they can reach it.
- **`src/backend/app/pricing.py`** loads the JSON and exposes `CREDIT_PACKS` (Stripe-facing name
  composed here) and `CREDIT_VALUE` = worst-case per-credit rate rounded UP to a whole cent
  (399c/80 = 4.9875c -> 0.05, identical to the old constant). `payments.py` and
  `storage_credits.py` import from it.
- **`src/frontend/src/config/pricing.js`** reads the same file with the same rules, store-free so
  the landing site imports it via its existing `@editor` alias. Exposes `CREDIT_PACKS`,
  `BEST_VALUE_PACK`, `LOWEST_RATE_CENTS`, `CREDIT_VALUE`, `packPriceUsd`, `costAtBestRateUsd`.
  `storageCost.js` imports `CREDIT_VALUE` from it (the "keep in sync" comment is gone).
- **Landing** `index.astro`: pricing cards, the lowest-rate stat, the "Best Value" highlight and
  the whole worked example (storage credits via the app's own `calculateUploadCost`) are
  computed at build time. `site.ts` no longer carries a ladder.
- **Frontend dev server**: `vite.config.js` gains `server.fs.allow` for the repo `src/` dir so
  the cross-package JSON import is served in dev (the production build already resolved it).
- **Tests** assert the ladder's INVARIANTS (ascending price, strictly decreasing per-credit
  rate, the `CREDIT_VALUE` derivation rule, `/payments/config` == ladder) and derive every
  storage expectation from the formula, so a reprice is a one-file edit with zero test churn.
  New `src/frontend/src/config/pricing.test.js` mirrors the backend invariants.

Deliberately unchanged: `BuyCreditsModal.jsx` still renders packs from `GET /api/payments/config`
at runtime (the backend stays billing truth for the app), and the Stripe-facing pack name format
is preserved so the Stripe product name does not change.

## Context

### Relevant Files
- `src/backend/app/pricing.json` (new), the single source
- `src/backend/app/pricing.py` (new), Python derivation
- `src/backend/app/routers/payments.py`, imports `CREDIT_PACKS`
- `src/backend/app/services/storage_credits.py`, imports `CREDIT_VALUE`
- `src/frontend/src/config/pricing.js` (new) + `pricing.test.js` (new), JS derivation
- `src/frontend/src/utils/storageCost.js`, imports `CREDIT_VALUE`
- `src/frontend/vite.config.js`, `server.fs.allow`
- `src/landing/src/site.ts`, `src/landing/src/pages/index.astro`, derive instead of mirror
- Tests: `src/backend/tests/test_t4940_pack_pricing.py`, `test_storage_extension.py`,
  `src/frontend/src/components/BuyCreditsModal.test.jsx`, `StorageExtensionModal.test.jsx`
- `.claude/knowledge/backend-services.md`, T4940 entry updated

### Related Tasks
- Blocks: T10220 (reprice to 12.99 / 22.99 / 32.99). That task becomes a `pricing.json` edit
  plus the credits-per-tier decision.
- Builds on: T4940 (packs single-sourced from the backend for the app)

### Technical Notes
- `CREDIT_VALUE` is DERIVED, not configured: worst-case rate, ceil to a cent. A reprice that
  changes the worst-case rate moves the storage-cost formula on both sides together, which is
  the coupling T4940 documented and the old mirrored constants could silently break.
- Ladder invariants are enforced by tests on both sides: a `pricing.json` edit that breaks
  "bigger pack is cheaper per credit" fails CI.

## Implementation

### Progress Log

**2026-09-17**: Implemented inline on `feature/T10210-pricing-single-source` (M-tier, shared
checkout). Verified: backend `test_t4940_pack_pricing.py` + `test_storage_extension.py` 34/34;
frontend `pricing.test.js` + `BuyCreditsModal.test.jsx` + `StorageExtensionModal.test.jsx` +
`displayNames.credits.test.js` 25/25; ruff + eslint clean; `src/landing` `npm run build` green
and `dist/index.html` still contains exactly `3.8&cent;`, `30 days: 3 credits`, `45 credits`,
`48 credits total`, `about $1.83` (identical derived copy); `src/frontend` `vite build` green.

## Acceptance Criteria

- [x] Exactly one file holds pack prices/credits; no second copy in app, landing or backend source
- [x] Backend `CREDIT_VALUE` and frontend `CREDIT_VALUE` derive from the same file with the same rule
- [x] Landing pricing cards, lowest-rate stat and worked example derive at build time
- [x] Tests assert invariants, not literals; a reprice needs no test edits
- [x] Landing build output unchanged for the current ladder
- [ ] Reviewer pass on the diff
- [ ] Branch CI green, merged
