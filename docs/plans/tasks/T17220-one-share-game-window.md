# T17220: One Share game window

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

"Share game" opens two different windows: from Mark Plays an email-only one, from the Home game menu one with "Anyone with the link", Copy link and Turn off link and a "Share with 0" button. In the email-only one, a typed address leaves Share grey until Enter is pressed, with no hint. Done when the parent sees the change described below.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f). The owner agreed in the confusion review (https://claude.ai/artifact/QDjidEXfCW1HuNXby2RYLC, finding U07), and a UX expert review (Fable model, same day) settled the final change below. Screenshots: `qa/qa-pass-2026-11-17/ux/` (local, not in git).

This is a confusion finding the owner agreed to fix, not a breakage, so there are no repro logs.

## Solution

- Use the Home window everywhere.
- Accept a valid typed email on blur or when the button is tapped, not only on Enter.
- The button reads "Send", disabled until an email is added; never "Share with 0".

## Relevant Files

Names in the Solution come from the UX expert's code read; otherwise not investigated.

## Acceptance Criteria

- [ ] C1: "Share game" from Mark Plays and from Home open the same window.
- [ ] C2: Typing one email and tapping Send shares without pressing Enter; no "Share with 0" anywhere.
