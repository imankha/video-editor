# T17200: Home first run: one clear start

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

A brand new parent lands on Home and sees the heading "Review your game" (before they have one) with two equal buttons, "Upload game" and "Skip ahead to Plays.". The "You start with 88 free credits" note appears under the coach's dark shade and is gone after "Got it", so it is never read. The upload window then talks about "a zip of plays" twice to someone who has one game video. Done when the parent sees the change described below.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f). The owner agreed in the confusion review (https://claude.ai/artifact/QDjidEXfCW1HuNXby2RYLC, finding U13, U14, U15), and a UX expert review (Fable model, same day) settled the final change below. Screenshots: `qa/qa-pass-2026-11-17/ux/` (local, not in git).

This is a confusion finding the owner agreed to fix, not a breakage, so there are no repro logs.

## Solution

- Empty Games tab: heading "Start with your game video", one "Upload game" button, and a small link "Only have short videos? Upload a play".
- Remove the floating credits caption in `CreditBalance.jsx`. First Home coach sentence: "Upload your game to start. You have 88 free credits, enough for about N highlights." (N computed from real pricing) with the credit chip cut out of the shade for that rule. With Guidance off, show the same line as plain text in the empty Games state, never both.
- Upload drop zone: one line "Tap to choose your game video" with small text "MP4, MOV or WebM"; zips move to a quiet "Have a zip of plays?" link. Update the matching `GUIDE` strings and the named-controls test.

## Relevant Files

Names in the Solution come from the UX expert's code read; otherwise not investigated.

## Acceptance Criteria

- [ ] C1: A new account at 390x844 sees "Start with your game video" and a single primary button.
- [ ] C2: The free-credits sentence is readable on first arrival with Guidance on and with it off, and appears only once.
- [ ] C3: The upload window mentions zips only in the "Have a zip of plays?" link.
