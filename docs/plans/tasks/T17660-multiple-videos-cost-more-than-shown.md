# T17660: Multiple videos cost more than shown

**Status:** STAGING
**Impact:** 9
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

A parent adds two videos to a game. Before confirming, the window says the cost is two credits. The account loses four credits instead. This happened on three batches, including two batches of very small videos. The price shown before confirmation must equal the credits taken.

## How we got here

Found by the full QA continuation on 2026-11-18 on staging, build ce8988c54 (#8063), as e2e@test.local, desktop 1440 x 900. This is the returning parent flow.

## Repro steps

1. Open a game on staging and move outside any selected play so Add video is available.
2. Click Add video and select two videos together.
3. Read the cost and the balance. The evidence window says Cost: 2 credits and shows two selected videos.
4. Click Add to this game.
5. Wait for both videos to finish and compare the balance.

**Expected:** The displayed cost and the credits deducted agree.
**Actual:** Two credits are shown, but four are deducted.
**Repeats:** 3 of 3 batches. Each batch reopened the window. The first used an 89 second soccer video plus a 5 second fixture. The next two each used two unique 5 second fixtures.
**Also checked at:** Other device classes not yet checked for this exact purchase confirmation.

## Evidence

- Screenshots: `qa/qa-pass-2026-11-18/bugs/B04-multi-video-price-2.png` and `B04-multi-video-price-3.png` (local, not in git).
- Balances: 74 to 70, 70 to 66, and 66 to 62. Every quoted cost was 2 credits.
- Measured record: `qa/qa-pass-2026-11-18/bugs/B04-batch-prices.json`.
- Console: no exception established as the cause of this price mismatch. The first batch intentionally tested offline recovery and completed after reconnecting.
- Network: prepare-upload and add-video requests succeeded. GET /api/credits confirmed each four-credit deduction. No failing request is needed to reproduce the mismatch.
- Server: no server-side failure established. The issue is the difference between the confirmation price and the successful charges.

## Solution

Before the parent confirms, the total shown covers every selected video and equals the total credits deducted.

## Relevant Files

Found by searching the Add video wording and its cost display:

- `src/frontend/src/components/AttachVideoModal.jsx`
- `src/frontend/src/components/GameDetailsModal.jsx`

## Acceptance Criteria

- [ ] C1: Selecting two videos shows the total that is actually deducted when both finish.
- [ ] C2: The total remains correct for one video and several videos, including files under one GB.
- [ ] C3: The same correct total is readable before confirmation on phone, tablet and desktop.
