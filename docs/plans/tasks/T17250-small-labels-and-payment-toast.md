# T17250: Line up label and payment confirmation

**Status:** STAGING
**Impact:** 3
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

Two small gaps: lining up a second game video is only a small clock icon on its strip, and after paying for credits the window closes with no message (the chip changes from 78 to 228). A "credits added" toast exists in the code but did not fire on the checkout path used. Done when the parent sees the change described below.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f). The owner agreed in the confusion review (https://claude.ai/artifact/QDjidEXfCW1HuNXby2RYLC, finding U17, U18), and a UX expert review (Fable model, same day) settled the final change below. Screenshots: `qa/qa-pass-2026-11-17/ux/` (local, not in git).

This is a confusion finding the owner agreed to fix, not a breakage, so there are no repro logs.

## Solution

- Add the words "Line up" next to the clock icon; tooltip "Line up this video with the game".
- After a successful payment show: "150 credits added. Your balance is 228." Find why `CREDITS.added` (fired from `handlePaymentSuccess` in `CreditBalance.jsx`) did not show on the in-window card checkout, and make sure the floating Report a problem button (T17060) does not cover it.

## Relevant Files

Names in the Solution come from the UX expert's code read; otherwise not investigated.

## Acceptance Criteria

- [ ] C1: The line-up control shows the words "Line up".
- [ ] C2: Paying for a pack with the test card shows the credits-added message with the new balance, at 390x844 and 1440x900.
