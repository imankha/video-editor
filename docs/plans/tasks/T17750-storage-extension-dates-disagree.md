# T17750: Storage extension dates disagree

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

A parent opens an expired game to buy thirty more days of storage. Before confirming, the window says the video will be available until December 18. After the purchase, the success message says December 19. This repeated on three games, although each one correctly charged one credit. The date shown before and after the purchase should agree.

## How we got here

Found by the full QA continuation on staging on 2026-11-18, build 91f0e6792 (#8105), desktop 1440 x 900. The storage check is the returning parent flow as e2e@test.local. The shared viewer is signed out.

## Repro steps

1. Use staging in the America/Los_Angeles timezone on November 18 while UTC is already November 19.
2. Open an expired game from Games. The evidence uses varC, varB and clipA on e2e@test.local.
3. Leave the extension at thirty days and read Added time.
4. Confirm Extend storage: 1 credit and read the success message.

**Expected:** The before-purchase date and the success date agree.
**Actual:** The quote says December 18, 2026, and success says December 19, 2026.
**Repeats:** 3 of 3 games, each in a newly opened extension window.
**Also checked at:** Other device classes not checked for this exact fault yet.

## Evidence

- Screenshots: `qa/qa-pass-2026-11-18/bugs/B06-storage-date-varB-quote.png`, `B06-storage-date-varB-after.png`, and corresponding clipA images.
- Measured record: `qa/qa-pass-2026-11-18/bugs/B06-storage-dates.json`.
- Browser timezone: America/Los_Angeles; observed local time November 18, 2026 at 22:14, UTC November 19 at 06:14.
- Credits: 54 to 53, 53 to 52, and 52 to 51, as quoted.
- Network: extension and balance requests succeeded. Console and server: no failure established as the cause of the date mismatch. No claim is made here about the actual retention cutoff beyond the two dates shown.

## Solution

The extension quote, confirmation and retained-until date use the same date for the chosen period.

## Relevant Files

- `src/frontend/src/components/StorageExtensionModal.jsx`, found by searching Storage extended until.
- `src/frontend/src/config/displayNames.js`, found by searching Added time.

## Acceptance Criteria

- [ ] C1: Quote and success show the same date when local and UTC dates differ.
- [ ] C2: The thirty-day and longer extension choices still charge the displayed amount.
