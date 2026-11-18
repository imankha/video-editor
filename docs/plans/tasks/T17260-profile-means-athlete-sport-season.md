# T17260: Explain what a profile is

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

A profile is one athlete in one sport for one season, but nothing says so. The Add profile window's only hint is the placeholder "e.g. Fall Soccer 2025", which explains the season but not the athlete. Done when the parent sees the change described below.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f). The owner agreed in the confusion review (https://claude.ai/artifact/QDjidEXfCW1HuNXby2RYLC, finding U19), and a UX expert review (Fable model, same day) settled the final change below. Screenshots: `qa/qa-pass-2026-11-17/ux/` (local, not in git).

This is a confusion finding the owner agreed to fix, not a breakage, so there are no repro logs.

## Solution

- Label "Profile name"; placeholder follows the Sport field, for example "e.g. Maya, Fall Soccer 2026" (fits the 30 character cap).
- Hint under the field: "One profile for each athlete, sport and season. Games and highlights stay separate in each."
- Use the first sentence as the subtitle of the Add profile window and of the Manage profiles list.

## Relevant Files

Names in the Solution come from the UX expert's code read; otherwise not investigated.

## Acceptance Criteria

- [ ] C1: The Add profile window and the profile list both say a profile is for each athlete, sport and season.
