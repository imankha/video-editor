# T8950: Audit the credit pricing model for high-resolution/high-fps source files

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-05
**Related:** Universal Upload & Angles epic (`docs/plans/tasks/universal-upload/EPIC.md`) —
this is a pricing-calibration concern raised alongside that epic's live-testing session,
not a task inside its own strict-order list.

## Problem

Raised during live-testing feedback (2026-09-05): "the cost of the credits to upload
should be based on the upload size... 2 credits was right for 3GB or whatever our average
has been so far, but we need to be prepared for higher resolutions and fps."

Cost IS already purely byte-size-based (`storageCost.js`'s `calculateStorageCost` /
`calculateUploadCost` — no resolution/fps term at all, by design, since R2 storage cost is
a function of bytes, not pixels). What is NOT yet audited is whether the CALIBRATION and
surrounding UX still make sense as typical file sizes shift upward. The Universal Upload
epic's own evidence base already documents the shift: a single 8K/60fps DJI camera game is
`4x ~97 Mbps segments, ~50 GB/game` — at current rates
(`R2_RATE_PER_GB_MONTH=0.015`, `MARGIN=0.10`, `CREDIT_VALUE=0.05`,
`AUTO_EXPORT_SURCHARGE=1`), that's `ceil(50 * 0.015 * 1.10 / 0.05) + 1 = 18 credits` for
ONE game — roughly 9x today's typical ~2-credit charge for a ~3GB 1080p upload.

**Not a formula bug** — the linear byte-based math is correct and matches the R2 pricing
model it mirrors. The open questions are about calibration and surrounding UX:

1. Does an 18+ credit single-game charge still make sense against current credit-pack
   pricing/marketing copy (any "typical game costs ~2 credits" messaging anywhere)?
2. Does the credit-purchase flow (`BuyCreditsModal`, insufficient-credits gate) handle a
   double-digit required-credits number gracefully (copy, pack-size suggestions)?
3. Should `MARGIN`/`R2_RATE_PER_GB_MONTH` be revisited now that large-file uploads are a
   real, common case (post-Universal-Upload) rather than an edge case?
4. Cross-check against the shrink feature's (T8830-T8860) whole incentive: the shrink
   offer only renders above `SHRINK_OFFER_MIN_BYTES = 3 GB` specifically BECAUSE large
   files are expensive to store AND slow to upload — confirm the offered presets'
   estimated post-shrink sizes land in a credit range that reads as "worth compressing"
   without the always-available "upload as-is" path feeling punitive.

**Explicitly NOT in scope** (already covered elsewhere): the real-time cost-preview UI as
the user adjusts crop/preset in the shrink step is already speced in T8850 ("modal's cost
banner recalculates from the ESTIMATED size... credits delta via
`calculateUploadCost(originalBytes)` minus `calculateUploadCost(estimatedBytes)`").

## Solution (to be scoped at implementation time)

Investigation-first task — classify tier once the audit's findings are known. Likely
outputs: either "calibration is fine, no change" (a real possible outcome, documented) or
adjustments to `storageCost.js`'s constants, `BuyCreditsModal` copy/pack suggestions, or
both.

## Relevant Files

- `src/frontend/src/utils/storageCost.js` — the pricing formula
- `src/frontend/src/components/BuyCreditsModal.jsx` (or wherever the credit-purchase UI
  lives) — copy/pack-size handling for large charges
- `docs/plans/tasks/universal-upload/T8850-shrink-ui-crop-step.md` — the real-time
  preview this task must NOT duplicate

## Acceptance Criteria

- [ ] A documented verdict on whether current pricing constants need adjustment for
      8K+/50GB+ source files, with the actual math shown (not just "seems fine")
- [ ] Credit-purchase UI/copy reviewed for double-digit charge amounts
- [ ] Shrink-preset economics cross-checked (does compressing meaningfully reduce the
      credit cost in a way the UI should say out loud?)
