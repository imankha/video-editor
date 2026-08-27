# T7810: Staging Gate phase 2 - adapt annotate-save and credits specs into the lanes

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-26
**Updated:** 2026-08-26

## Problem

Two surfaces remain uncovered by the v2 staging gate (T7800) because their existing specs
are not staging-ready as written:

1. **Annotate save-clip write gesture**: `T7540-annotate-save-tag-trap.qa.spec.js` is the
   only spec covering the save gesture, but its `waitForVideoSeekable` budget (120s)
   exceeds the 60s deployed per-test timeout, and it hardcodes game 6 + profile 9fa7378c.
2. **Credits/monetization UI**: `t4940-monetization-qa.spec.js` hardcodes the imankh email
   and asserts literal pack prices ($3.99/$6.99/$12.99) and copy, so any price change
   fails the gate spuriously.

## Solution

- T7540: parameterize the game (discover an ACTIVE game like annotate-game-clock), trim
  the seek-candidate scan so it fits the 60s deployed budget (or set an explicit
  test.setTimeout with justification), keep its create-then-delete cleanup, tag
  `@staging-gate @gate-b` (it self-cleans, so lane B is safe).
- t4940: env-driven identity (E2E_REAL_EMAIL), assert structure (3 packs, prices present
  and ordered, explainer visible) instead of literal prices, tag `@staging-gate @gate-c`.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/e2e/T7540-annotate-save-tag-trap.qa.spec.js`
- `src/frontend/e2e/t4940-monetization-qa.spec.js`
- `src/frontend/e2e/helpers/targetEnv.js` - STAGING_GATE_SPECS inventory update

### Related Tasks
- Depends on: T7800 (lane infrastructure + tags + runbook script)

### Technical Notes
- T7540 writes a real clip via POST /api/clips/raw/save and deletes it in afterEach,
  throwing if cleanup fails: acceptable in lane B only because lane A owns heavy writes.
- Note from the T7800 analysis: `T6190-project-open-fetches.qa.spec.js` criterion 4
  permanently edits a real clip boundary with no restore. It stays local-only, but adding
  a restore step there is worthwhile opportunistic scope if touched.

## Implementation

### Steps
1. [ ] T7540: game discovery + deployed-budget fit + tags
2. [ ] t4940: env identity + structural assertions + tags
3. [ ] Update STAGING_GATE_SPECS inventory (15 specs)
4. [ ] Timed staging run confirms the gate stays under 20 min

## Acceptance Criteria

- [ ] Both specs run green against staging in their lanes
- [ ] Gate wall clock still under 20 min
- [ ] t4940 survives a price change without edits
