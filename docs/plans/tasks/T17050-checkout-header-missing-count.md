# T17050: Checkout header missing highlight count

**Status:** TODO
**Impact:** 3
**Complexity:** 1
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

When a parent picks a credit pack, the payment window's heading reads "Starter: 150 credits" and under it "$6.99 · ~ plays". The number is missing, and it says "plays" where the pack list just said "~10 highlights". A parent about to pay sees a half-finished line. It should read like the pack list, for example "$6.99 · ~10 highlights".

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as imankh+qa-2026-11-17b@gmail.com, at phone 390x844 touch.

## Repro steps

1. Sign in, tap the credit chip at top left.
2. Tap the 150 credits pack (or the 340 pack).
3. Read the line under the heading.

**Expected:** "$6.99 · ~10 highlights".
**Actual:** "$6.99 · ~ plays" (340 pack: "$12.99 · ~ plays").
**Repeats:** always (2 of 2 packs)
**Also checked at:** desktop checkout uses the same component (not separately screenshotted).

## Evidence

- Screenshot: `qa/qa-pass-2026-11-17/bugs/r2-B05-checkout-header.png` (local, not in git)
- Console, network, server log: nothing relevant.

## Solution

The checkout heading shows the same "~N highlights" figure as the pack card.

## Relevant Files

- `src/frontend/src/components/BuyCreditsModal.jsx` line 256: `{selectedPack.price} · ~{selectedPack.plays} plays` (the pack cards use `approxHighlights(p.credits)` and "highlights", see `BuyCreditsModal.test.jsx`).

## Acceptance Criteria

- [ ] C1: At 390x844, the checkout heading for each pack shows a number and the word "highlights", matching its pack card.
- [ ] C2: The same at 1440x900.
