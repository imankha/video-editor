# T16590: The "turn Guidance off" test helper gives up too early

**Status:** TODO
**Impact:** 4
**Complexity:** 1
**Created:** 2026-11-15
**Updated:** 2026-11-15

## Problem

Browser checks that click app controls on staging sign in as the shared check account, which has the coaching
guide (called Guidance) switched on. While Guidance is on, a dark shade covers everything except the one control
the current step points at, so a click on any other button is swallowed and the check just waits until it times out.

To avoid that, checks call `disableGuidanceForCheck` (in `src/frontend/e2e/helpers/checkAuth.js`) to switch
Guidance off first. The helper looks for the Guidance switch once, and if the switch has not appeared yet it
returns at once and does nothing. On a freshly loaded page the switch is not there yet, so Guidance stays on.

Seen on 2026-11-15 while checking T4410 and T2650 on staging: the stock check `e2e/checks/T16090.check.spec.js`
hung with no network traffic until it was killed, because Guidance stayed on and its shade swallowed the
"Make highlight" click. A throwaway test that waited for the switch before reading it worked on the first try.
The helper's own comment says three earlier checks (T15550, T15640, T15980) already lost time to this same shade.

Related, not part of this task: `derisk-staging-export.qa.spec.js` fails at "Clips button not visible" because
the Home screen changed. It needs its own task.

## Solution

Make the helper wait, for a short time, for the Guidance switch to appear before it decides there is nothing to do.
If the switch never appears within that time, it still returns without error (some screens have no switch). If the
switch appears and is on, it clicks it and waits for it to read off, as today. No other behaviour changes.

## Why

A check that hangs until its timeout wastes 10 to 20 minutes of the verify or staging-check budget and looks like a
product failure. Every browser check that uses this helper is exposed on every fresh page load.

## Relevant Files

- `src/frontend/e2e/helpers/checkAuth.js`
- `src/frontend/e2e/checks/T16090.check.spec.js`

## Acceptance Criteria

- [ ] C1: `disableGuidanceForCheck` waits up to a few seconds for the Guidance switch to be visible, then switches it
  off if it is on. A check on a freshly loaded page that has Guidance on ends with Guidance off.
- [ ] C2: On a page with no Guidance switch the helper returns within that wait without error.
- [ ] C3: `npx playwright test e2e/checks/T16090.check.spec.js` on the dev stack passes without hanging; the same file
  run against staging (`E2E_BASE_URL`, `E2E_API_BASE`) gets past the "Make highlight" click.
