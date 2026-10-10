# T12300: Guidance stays on until the user turns it off, and the choice persists

**Status:** STAGING
**Impact:** 3
**Complexity:** 2
**Tier:** S
**Created:** 2026-10-08
**Updated:** 2026-10-08
**Epic:** [Epic 4: Guide correction](EPIC.md) | **Milestone:** [Staging QA Walkthrough](../README.md)
**Source:** [walkthrough findings](../../../ux/2026-10-08-staging-qa-walkthrough/findings.md)

**Decision RULED 2026-10-08 (Q16 = A):** Guidance is ON for everyone by default and stays on until the user turns it off. Once the user turns it off, that value must persist. There is no "off after first export" rule (the 2026-09-17 T7630 idea is superseded for this milestone).

## Problem

The user wants the Guidance switch to be a plain preference: on by default, off only when the user chooses, and the choice sticks. Today the toggle and the bubble's X both call `setCoachEnabled` (settingsStore.js:179-181), which sends `PUT /api/settings {guidance:{coachEnabled}}` (settingsStore.js:109-136) with an optimistic update and a revert on failure. That path is the right gesture-based design, but persistence of the value has not been proven end to end, and two defects can make the value appear not to stick:

- The X uses `void setCoachEnabled(false)` (InstructionCoach.jsx:31). If the save fails, the store reverts and only logs to the console, so the bubble silently reappears (the toggle itself shows an error, GuidanceToggle.jsx:20). T12290 fixes the silent failure.
- `coachEnabled = true` destructuring defaults are repeated in 8 places over data that already defaults in `DEFAULT_SETTINGS` (settingsStore.js:45-47). T12290 removes those; this task must not reintroduce a second default.

## Solution

Prove and, if needed, fix persistence; add no new write path and no derived or reactive default.

1. Confirm where the `guidance` settings live on the backend (per-user store, synced to R2) and that the value is read back on login and after a reload, a second browser and a new session. Fix any path that drops or resets it (login init, settings migration, account reset, settings GET defaults overriding a stored false).
2. Keep the default ON for new accounts only through `DEFAULT_SETTINGS`; a stored `coachEnabled: false` always wins.
3. The only writers remain the toggle click and the bubble X (gesture handlers sending the single changed field).

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/stores/settingsStore.js`
- `src/frontend/src/components/instructions/GuidanceToggle.jsx`
- `src/frontend/src/components/instructions/InstructionCoach.jsx` (X handler; owned by T12290, coordinate)
- Backend settings router and its tests (find with `grep -rn "guidance" src/backend/app`)

### Related Tasks

- Depends on: T11950 (the toggle moves to the header; keep the same handler), T12290 (X failure surfacing and removal of duplicated defaults).
- Knowledge doc: `.claude/knowledge/persistence-sync.md` (settings sync).

## Implementation

### Steps

1. [ ] Load the knowledge doc; trace GET/PUT /api/settings for the guidance key
2. [ ] Write the failing test(s) below and observe the intended failure (if persistence already works, record the passing evidence and close with tests only)
3. [ ] Fix any reset or default-override found; no reactive persistence
4. [ ] Run the relevant tests plus explicit lint; one fresh-context Reviewer on the diff
5. [ ] Commit with subject starting `T12300:` and the co-author line

### Progress Log

**2026-10-08**: Filed, then re-scoped the same day after the user ruled Q16 = A (on until the user turns it off; value persists). Originally "on until the first export".

## Acceptance Criteria

- [ ] A new account starts with Guidance on
- [ ] After the user turns Guidance off, a reload, a new session and a second browser all still show it off
- [ ] A stored off value is never overwritten by a default on login or settings load
- [ ] The only writes are the toggle click and the bubble X, each sending only the changed field
- [ ] Relevant tests pass and lint is clean
