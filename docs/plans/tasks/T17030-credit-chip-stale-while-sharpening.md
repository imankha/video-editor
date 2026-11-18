# T17030: Credit chip stale while sharpening

**Status:** WIP
**Impact:** 4
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

When a parent taps "Sharpen my highlight", the credits are taken at once, but the credit chip at the top of the screen keeps showing the old balance for the whole sharpen (about three minutes), on Frame and on Home. A parent checking what they just paid sees no change and may think nothing was charged, or think they have more credits than they do. The chip should show the new balance as soon as the credits are taken. (Uploading a game, by contrast, updates the chip right away.)

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as imankh+qa-2026-11-17b@gmail.com, at phone 390x844 and desktop 1440x900.

## Repro steps

1. Sign in, open a play in Frame, note the chip (for example 226).
2. Tap "Sharpen my highlight" (price shown "~8 credits").
3. Wait 10 seconds and read the chip; also ask the server for the balance (GET /api/credits).

**Expected:** chip shows 218, the same as the server.
**Actual:** chip still shows 226 while the server says 218. It changes to 218 only when the sharpen finishes. On the phone it stayed at 86 (server 78) on Frame and on Home until a credit purchase refreshed it.
**Repeats:** 2 of 2 sharpens checked (phone and desktop)
**Also checked at:** iPad not checked.

## Evidence

- Screenshots: `qa/qa-pass-2026-11-17/bugs/r2-B02-chip-86-after-charge-phone.png`, `r2-B02-chip-226-after-charge-desktop.png` (local, not in git)
- Console: no errors.
- Network: GET /api/credits returned 78 (phone) and 218 (desktop) while the chip showed 86 and 226.
- Server log: nothing relevant.

## Solution

The credit chip shows the new balance as soon as a sharpen's credits are taken.

## Relevant Files

Not investigated.

## Acceptance Criteria

- [ ] C1: At 1440x900, within a few seconds of tapping "Sharpen my highlight", the chip equals GET /api/credits.
- [ ] C2: The same at 390x844, on Frame and after going back to Home mid-sharpen.
