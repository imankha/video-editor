# T13430: Credit history overstates balances while a generation charge is pending (verify)

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Tier:** S/M (credits display)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Outside AI new-user QA run on staging, 2026-10-25/26 (`docs/plans/ux/2026-10-25-staging-new-user-test-prompt.md`, account imankh+stg-qa-20261025@gmail.com). Not yet reproduced by us.

## Problem

The tester reported that the running balances shown in credit history are too high while a highlight generation's charge is pending, so the history disagrees with the balance shown elsewhere until the job finishes. Credit numbers are money; a parent comparing the two will not trust either. The tester's end state was consistent (173 credits, matching 65 used), so the gap appears only during a pending charge.

## Solution

Reproduce: start a generation on staging, open credit history before it finishes, and compare each row's running balance with the header balance. Then show a pending charge as pending (or reserve it) so every number on the screen agrees.

## Context

### Relevant Files
- Credit history UI and its API (`src/backend/app/routers/credits.py`, `services/credit_ledger.py`)

### Related Tasks
- None

## Acceptance Criteria

- [ ] While a generation is running, credit history and the header balance agree, with the pending charge clearly marked
- [ ] A test covers the pending-charge row
