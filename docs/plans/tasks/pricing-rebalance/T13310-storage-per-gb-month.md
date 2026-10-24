# T13310: Storage priced per GB-month, decoupled from the pack ladder

**Status:** STAGING
**Impact:** 6
**Complexity:** 3
**Created:** 2026-10-23
**Updated:** 2026-10-23

Epic: [Pricing Rebalance](EPIC.md). Epic 1/3, foundation; T13320 depends on it.

## Problem

Storage charges are derived from the pack ladder: `calculate_storage_cost` divides the R2 dollar
cost by `CREDIT_VALUE`, and `CREDIT_VALUE` is the worst-case (highest) per-credit pack rate ceil'd
to a cent (`app/pricing.py`, mirrored in `src/frontend/src/config/pricing.js`). Every reprice
therefore silently changes what an upload costs: T4940 moved it 7.2c to 5c, T10220 moved it 5c to
4c (+25% credits per byte-month). The planned $6.99 / 150 entry rung (4.66c) would push it back to
5c and raise upload charges 25% again. The formula is also opaque to the parent ("ceil of GB x
0.015 x 1.1 / anchor + 1").

User ruling 2026-10-23 (epic decision P4): charge storage per GB at roughly what we pay, with a
cushion for bandwidth, and stop deriving it from the ladder.

## Solution

One rule, stated on every credit surface: **1 credit per GB per 30 days, GB rounded up, minimum
1 credit**, plus the existing +1 auto-export surcharge on upload (P5: keep).

```
storage_credits(bytes, days) = max(1, ceil( ceil_gb(bytes) * days / 30 ))
upload_cost                  = storage_credits(bytes, 30) + AUTO_EXPORT_SURCHARGE   # +1
extension_cost(bytes, days)  = storage_credits(bytes, days)
```

Cost basis (so the margin is on record): R2 storage $0.015 per GB-month; game video is served
and uploaded via presigned URLs (R2 egress is free); only clip previews and highlight downloads
stream through Fly (~$0.02 per GB, a few cents per game); R2 class A/B operations are negligible.
At 3.0c to 4.66c per credit the rule recovers roughly 2x cost including bandwidth. A 6 GB game
costs 6 + 1 credits (about 25 cents at the middle rung).

Delete `CREDIT_VALUE` from both pricing modules and `storage_credits.py`; nothing else may read
the pack ladder to price storage. Pin that with a test: changing `pricing.json` leaves every
storage charge unchanged.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/storage_credits.py` - `calculate_storage_cost`, `calculate_upload_cost`, `calculate_extension_cost`, `R2_RATE_PER_GB_MONTH`, `MARGIN` (remove), `AUTO_EXPORT_SURCHARGE` (keep)
- `src/backend/app/pricing.py` - remove the derived `CREDIT_VALUE` export and its docstring example
- `src/frontend/src/config/pricing.js` - remove the `CREDIT_VALUE` mirror
- `src/frontend/src/utils/storageCost.js` - frontend mirror of the storage rule (upload preview + extension modal must equal the backend charge)
- `src/landing/src/pages/index.astro` - worked example (`calculateUploadCost(EXAMPLE_GAME_GB ...)`) and any "storage costs credits" copy; `src/landing/src/site.ts` FACTS
- `src/frontend/src/components/BuyCreditsModal.jsx` "How credits work" explainer, `InsufficientCreditsModal.jsx`, `StorageExtensionModal`, upload-side storage preview - state the rule in words
- `src/frontend/src/config/displayNames.js` - credit rule copy if centralized there (T9480 single-sourced the export rule copy; follow the same pattern)
- Tests: `src/backend/tests/test_storage_extension.py`, `test_t4940_pack_pricing.py` (drop the anchor assertions), frontend `storageCost` tests, `pricing.test.js`
- Knowledge: `.claude/knowledge/export-pipeline.md` or wherever storage credits are documented; `docs/plans/tasks/monetization-pass/T4940-...md` (append the decision)

### Related Tasks
- Blocks: T13320 (ladder reprice must not move storage charges)
- History: T1580 (storage credits), T1582 (+1 surcharge), T4940, T10210, T10220

### Technical Notes
- Backend and frontend MUST compute the same number (T4940 invariant: the preview, the modal and
  the charge never disagree). Keep one function per side and a parity test with shared fixtures
  (0.5 GB, 1 GB, 2.5 GB, 6 GB, 6.4 GB, 20 GB at 30 / 7 / 60 days).
- Existing games are not re-billed; the rule applies to new uploads and new extensions from the
  deploy on. No migration (no stored charge changes).
- Rounding: GB is `bytes / 1024**3` rounded UP, then days scale, then round up again; minimum 1.
  Spell the minimum out in the explainer ("even a tiny file is 1 credit per 30 days").
- Copy rule: "highlight" never "reel"; no em dashes; no "Saved" chips.

## Implementation

### Steps
1. [ ] Backend rule + tests (parity fixtures), delete `CREDIT_VALUE` and `MARGIN`
2. [ ] Frontend mirror + tests; upload preview, extension modal and explainer copy
3. [ ] Landing worked example and FAQ copy; `npm run build` in `src/landing`, eyeball the pricing section
4. [ ] Pin test: edit the ladder in a test fixture, assert storage charges unchanged
5. [ ] Update T4940 doc and the touched knowledge doc

### Progress Log

**2026-10-23**: Filed from the pricing analysis (epic Evidence section). Ruling P4/P5.

## Acceptance Criteria

- [ ] 6 GB upload, 30 days: 7 credits in the app preview, the backend charge and the landing example
- [ ] 6 GB extension, 30 days: 6 credits; 2.5 GB upload: 4 credits; 0.5 GB upload: 2 credits
- [ ] `CREDIT_VALUE` no longer exists in `src/`; grep covers `src/`, `e2e/`, `scripts/`
- [ ] Changing `pricing.json` leaves every storage charge unchanged (test)
- [ ] Curated tests pass (storage extension, pricing, storageCost, BuyCreditsModal explainer)
