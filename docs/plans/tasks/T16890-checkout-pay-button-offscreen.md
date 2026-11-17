# T16890: Checkout payment button is unreachable

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

A parent chooses the smallest credit pack and opens the card form. The form grows taller than the screen, putting the payment button below the bottom and its heading above the top. Scrolling does not bring the payment button into view. This repeated on all three attempts at phone width and also appeared on desktop. The whole form and its payment button should be reachable at normal screen sizes.

## How we got here

Found by the full QA pass on 2026-11-17 on staging, build 7a6b3123b (#7949), as the new parent test account, at 390 x 844 with mouse input. This was viewport testing, not real touch emulation.

## Repro steps

1. Sign in to staging as a parent at 390 x 844.
2. Open the credit balance chip, dismiss Guidance if present, and choose the 150 credit pack for $6.99.
3. Dismiss the checkout coach and expand Card.
4. Wait for the full card form, including the optional contact fields, to appear.
5. Try to scroll to Pay $6.99.

**Expected:** The payment button and the entire card form can be reached by scrolling.
**Actual:** Pay $6.99 is below the viewport and scrolling does not expose it. The heading and close controls are above the viewport too.
**Repeats:** 3 of 3 tries, including two fresh reloads.
**Also checked at:** 1440 x 900, also extends beyond the screen. A temporary 1440 x 1600 viewport allowed a successful test payment. Tablet and touch input were not checked.

## Evidence

- Screenshot: `qa/qa-pass-2026-11-17/bugs/B01-checkout-phone.jpg` and `B01-repro2.jpg`, `B01-repro3.jpg` (local, not in git).
- Logs: `qa/qa-pass-2026-11-17/bugs/B01-logs.txt` (local, not in git).
- Layout: payment button top 977.92, bottom 1025.92, height 48, viewport height 844. Card container height 1320, overflow visible. Parent is fixed, centered, height 844 and overflow visible.
- Console: separate capture saved locally. No console error has been established as the cause of this layout fault.
- Network: browser request capture is unavailable in this session. No failing application request was established for this layout fault.
- Server: Fly is signed in. The captured server log shows POST /api/payments/create-intent returning 200. No server error has been established for the layout fault.

## Solution

The parent can scroll through the entire checkout and reach its payment and close controls at every supported screen size.

## Relevant Files

- `src/frontend/src/components/BuyCreditsModal.jsx`, found by searching for the visible payment wording.

## Acceptance Criteria

- [ ] C1: The repro steps expose reachable payment and close controls at 390 x 844 and 360 x 640.
- [ ] C2: The complete card form is reachable at 768 x 1024, 1024 x 768 and the supported desktop sizes, with touch checks on phone and tablet.
