# T17100: Empty Highlights tab shows nothing

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

When a profile has no highlights yet, the Highlights tab on Home shows only the heading "Your highlights" and an empty page. There is no sentence saying what a highlight is or how to make one, and no button. The Games and Plays tabs each have an empty message with a next step; Highlights should too.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as e2e@test.local on a new, empty profile, at desktop 1440x900.

## Repro steps

1. Sign in, add a new profile and switch to it (or use a new account).
2. Home, tap the "Highlights" tab.

**Expected:** a short message and a button leading to the next step (for example to mark plays in a game).
**Actual:** only "Your highlights", nothing below it.
**Repeats:** always (2 of 2 loads)
**Also checked at:** phone not checked on an empty profile.

## Evidence

- Screenshot: `qa/qa-pass-2026-11-17/bugs/r2-B08-empty-highlights.png` (local, not in git)
- Console, network, server log: nothing relevant.

## Solution

An empty Highlights tab tells the parent how to get a highlight and offers a button for it.

## Relevant Files

Not investigated.

## Acceptance Criteria

- [ ] C1: On an empty profile at 1440x900, the Highlights tab shows a message and a next-step button.
- [ ] C2: The same at 390x844.
