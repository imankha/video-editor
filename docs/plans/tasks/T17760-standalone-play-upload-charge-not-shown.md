# T17760: Uploaded plays charge without a price

**Status:** STAGING
**Impact:** 8
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

A parent chooses Upload a play and picks a short video. The upload starts immediately, and one credit is taken before any price is shown. The first-use notice explains linking a play to a game but does not mention the charge. This repeated on three fresh page loads. A parent should know the upload cost before the app spends credits.

## How we got here

Found by the full QA continuation on 2026-11-18 on staging, build 91f0e6792 (#8105), as e2e@test.local at desktop 1440 x 900. This is the returning parent flow.

## Repro steps

1. Open Home, Plays on staging and note the credit balance.
2. Click Upload a play. On first use, read About uploaded plays and click Continue.
3. Select a short video under one GB.
4. Observe that the upload starts and opens Frame without a price or confirmation of the upload charge.
5. Compare the balance and the after-upload message.

**Expected:** The upload price is shown before credits are spent.
**Actual:** One credit is deducted automatically. Only after the upload does a message mention the one-credit charge.
**Repeats:** 3 of 3 fresh page loads with unique five-second test files.
**Also checked at:** Other device classes not checked for this exact charge disclosure.

## Evidence

- Notice screenshot: `qa/qa-pass-2026-11-18/ux/play-upload-notice.png`.
- Before and after screenshots: `qa/qa-pass-2026-11-18/bugs/B08-upload-play-before-2.png`, `B08-upload-play-after-2.png`, and corresponding attempt3 images.
- Measured record: `qa/qa-pass-2026-11-18/bugs/B08-upload-play-prices.json`.
- GET /api/credits confirmed balances 51 to 50, 50 to 49 and 49 to 48. POST /api/clips/upload returned 200 each time.
- Upload a play has no price in its text or title. About uploaded plays says only to pick videos or a zip and that the play can be linked to a game.
- Console and server: no failure established. These were successful uploads with an undisclosed charge.
- The three disposable uploaded plays were deleted after the checks; their screenshots and balance records remain.

## Solution

The parent sees the upload price before the upload begins spending credits.

## Relevant Files

Not investigated.

## Acceptance Criteria

- [ ] C1: A parent can see the upload cost before selecting or confirming a file that starts a charged upload.
- [ ] C2: The displayed amount or total remains correct for multiple files and larger files.
- [ ] C3: The price is readable on phone, tablet and desktop.
