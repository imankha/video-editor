# T17090: New profile says free credits

**Status:** WIP
**Impact:** 3
**Complexity:** 2
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

When a returning parent adds a second profile (for a second athlete) and switches to it, a bubble under the credit chip says "You start with 83 free credits". Those are the parent's own existing credits, shared across profiles, not a new gift. A parent may think they received free credits or that the profile has its own balance. The welcome bubble should only appear for a brand new account.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as e2e@test.local (83 credits), at desktop 1440x900.

## Repro steps

1. Sign in as an existing account with credits, desktop 1440x900.
2. Sport and profile chip, "Add profile", fill a name, "Create".
3. Look under the credit chip.

**Expected:** no "free credits" bubble.
**Actual:** "You start with 83 free credits".
**Repeats:** seen once (one new profile made); always likely, as it repeats on every new profile.
**Also checked at:** not checked on phone or iPad.

## Evidence

- Screenshot: `qa/qa-pass-2026-11-17/bugs/r2-B07-free-credits-new-profile.png` (local, not in git)
- Console, network, server log: nothing relevant.

## Solution

The "You start with N free credits" bubble shows only on a new account's first visit.

## Relevant Files

Not investigated.

## Acceptance Criteria

- [ ] C1: Adding and switching to a second profile on an existing account shows no "free credits" bubble, at 1440x900.
- [ ] C2: A brand new account still sees it once.
