# T17160: Admin windows ignore Esc

**Status:** WIP
**Impact:** 2
**Complexity:** 1
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

On the Admin Panel, the "Manage Campaigns" window and the "View journey" window do not close when Esc is pressed, while windows elsewhere in the app (for example Manage profiles) do. The owner has to find the Close button each time.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f), as the admin imankh@gmail.com, at desktop 1440x900.

## Repro steps

1. Admin Panel, click "Manage Campaigns", press Esc.
2. Close it, open "Users", click "View journey" on any user, press Esc.

**Expected:** each window closes.
**Actual:** both stay open.
**Repeats:** always (1 of 1 each, with the same result after a retry on journey)
**Also checked at:** desktop only (keyboard).

## Evidence

- Screenshots: `qa/qa-pass-2026-11-17/bugs/r2-B16-manage-campaigns-empty.png`, `.playwright-mcp/adm-09-journey.png` (local, not in git)
- Console, network, server log: nothing relevant.

## Solution

Esc closes every admin window, like the rest of the app.

## Relevant Files

Not investigated.

## Acceptance Criteria

- [ ] C1: At 1440x900, Esc closes "Manage Campaigns" and "View journey".
