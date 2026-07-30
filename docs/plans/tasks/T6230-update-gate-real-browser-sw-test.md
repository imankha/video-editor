# T6230: The update gate's ServiceWorker path has no real-browser test

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-30
**Updated:** 2026-07-30

## Problem

T6210 fixed the update-gate loop by requiring a probe to confirm a real waiting
ServiceWorker bundle before gating. The **decision** is well pinned — 8 new
regression tests in `appVersion.test.js`, including the exact 3163/3165 repro and
a 5-iteration reload loop that must never gate.

The **mechanism** is not tested at all. `probeForWaitingBundle`'s real
`registration.update()` / `registration.waiting` / `registration.installing`
behavior is jsdom-mocked. Every test asserts what happens *given* a stubbed probe
answer; nothing asserts the probe returns the right answer against a real
ServiceWorker.

This is the same false-confidence class as **T5380** (drag/pointer behavior that
passed in jsdom and was broken in a real browser) — hence the standing rule that
pointer/SW/browser-API fixes must be verified in a real browser.

**The specific risk is over-correction.** T6210 moved the gate from "fires when it
shouldn't" to "fires only when a bundle is provably waiting." If
`probeForWaitingBundle` never resolves truthy in a real browser — wrong lifecycle
timing, `update()` resolving before `waiting` is populated, a registration state
the mock doesn't model — the gate silently **never fires**. Users then sit on a
stale bundle indefinitely and no test goes red. The failure is invisible in CI by
construction.

Note the deliberate tradeoff T6210 shipped: no probe registered (SW unsupported,
private mode, failed or pending registration, dev server) = **no gate**. That is
intended and must not be "fixed" here — but it does mean a real-browser test has
to run somewhere a ServiceWorker actually registers, which the Vite dev server is
not.

## Solution

A Playwright test against a **built, served** app (not the dev server) that drives
the real SW lifecycle:

1. Load the app, wait for the ServiceWorker to register and activate.
2. Publish a second build to the same origin (new precache manifest).
3. Assert `probeForWaitingBundle` observes `registration.waiting` and the gate
   **does** appear — this is the over-correction guard, and the important half.
4. Assert the first-ever install (nothing to supersede) does **not** gate.
5. Assert the T6210 repro: server build ahead, no new bundle → no gate, across
   repeated reloads.

Serving two successive builds from one origin is the real work here — likely a
small static server fixture that can swap its build directory mid-test.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/pwaUpdate.js` — owns the registration; `probeForWaitingBundle`
- `src/frontend/src/utils/appVersion.js` — the decision + throttle/dedupe
- `src/frontend/src/utils/appVersion.test.js` — existing jsdom pins (do not delete)
- `src/frontend/src/stores/updateGateStore.js` — `_swReloader` seam
- `src/frontend/e2e/` — where the new spec lands

### Related Tasks
- Follow-up from: T6210 (`65841559`) — residual risk it explicitly recorded
- Precedent: T5380 (jsdom false confidence on browser APIs)
- Adjacent: T6220 (lockstep deploys) — independent; do not couple

### Technical Notes
- Must run against a production build; the dev server registers no SW.
- Keep the jsdom decision tests. This adds a layer, it does not replace one.
- The throttle is 5 minutes — the test needs to control or bypass it rather than
  wait, without weakening the production throttle.

## Implementation

### Steps
1. [ ] Build a fixture that serves two successive production builds from one origin
2. [ ] Spec: fresh install → SW activates → no gate
3. [ ] Spec: second build published → `registration.waiting` set → gate appears promptly
4. [ ] Spec: server build ahead with no new bundle → no gate across N reloads
5. [ ] Wire into the e2e suite; decide whether it belongs in the `@staging-gate` subset

### Progress Log

**2026-07-30**: Filed as a follow-up from T6210. Not started.

**2026-07-30 — interim manual check PASSED.** After the prod deploy to build #3171
(`f309731d`), the user loaded prod on a browser holding the old #3166 service
worker and got the update prompt **once**, which cleared permanently on Update.
So `probeForWaitingBundle` does resolve truthy against a real `registration.waiting`,
and the gate fires promptly — the over-correction risk is empirically ruled out for
this path.

**This does not close the task.** That was one observation, one browser, one
lifecycle timing — it is evidence, not a regression guard. Nothing currently goes
red if the probe breaks later. The remaining value here is purely automated
regression protection, so the urgency dropped but the scope did not.

## Acceptance Criteria

- [ ] A real browser with a real ServiceWorker exercises `probeForWaitingBundle`
- [ ] The suite goes RED if the probe never reports a waiting bundle (over-correction caught)
- [ ] The suite goes RED if the T6210 loop is reintroduced
- [ ] First-ever install does not gate
- [ ] Existing jsdom decision tests still pass unchanged
