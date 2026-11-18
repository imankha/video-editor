# T17210: Keep marking plays creates nothing

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

After a 5-star play, the app asks "Make this a highlight now?". Choosing "Keep marking plays" quietly creates an "In progress" portrait highlight the parent never asked for, and the line under the buttons says "Saves this play as a highlight in Plays", mixing two words. Done when the parent sees the change described below.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f). The owner agreed in the confusion review (https://claude.ai/artifact/QDjidEXfCW1HuNXby2RYLC, finding U05), and a UX expert review (Fable model, same day) settled the final change below. Screenshots: `qa/qa-pass-2026-11-17/ux/` (local, not in git).

This is a confusion finding the owner agreed to fix, not a breakage, so there are no repro logs.

## Solution

- Sub-line: "This play is saved. You can make its highlight any time." Buttons stay "Make highlight" / "Keep marking plays".
- "Keep marking plays" creates no highlight and picks no shape; that happens only on "Make highlight". The Plays tab ("Plays you're turning into highlights") and the `home.clips.*` coach rules currently rely on the auto-created draft, so adjust them.

## Relevant Files

Names in the Solution come from the UX expert's code read; otherwise not investigated.

## Acceptance Criteria

- [ ] C1: After "Keep marking plays", no new in-progress highlight exists for that play and the Plays tab count is unchanged.
- [ ] C2: The sub-line reads as written.
